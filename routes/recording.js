const express = require("express");
const multer = require("multer");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const router = express.Router();

// Configure multer for file upload
const upload = multer({
  dest: "uploads/recordings/",
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files
    if (file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"), false);
    }
  },
});

// Google Drive configuration
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

// Initialize Google Drive API
const initializeGoogleDrive = () => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: GOOGLE_SERVICE_ACCOUNT_KEY, // Path to service account JSON
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    return google.drive({ version: "v3", auth });
  } catch (error) {
    console.error("Failed to initialize Google Drive:", error);
    return null;
  }
};

// Upload recording to Google Drive
router.post("/upload", upload.single("recording"), async (req, res) => {
  try {
    const { phoneNumber, userId } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No recording file provided",
      });
    }

    console.log("📤 Uploading recording:", {
      originalName: file.originalname,
      size: file.size,
      phoneNumber,
      userId,
    });

    // Initialize Google Drive
    const drive = initializeGoogleDrive();
    if (!drive) {
      throw new Error("Google Drive not configured");
    }

    // Prepare file metadata
    const fileMetadata = {
      name: file.originalname,
      parents: GOOGLE_DRIVE_FOLDER_ID ? [GOOGLE_DRIVE_FOLDER_ID] : undefined,
      description: `Call recording for ${phoneNumber} by user ${userId}`,
    };

    // Upload to Google Drive
    const media = {
      mimeType: file.mimetype,
      body: fs.createReadStream(file.path),
    };

    const driveResponse = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id,name,size,webViewLink",
    });

    // Clean up local file
    fs.unlinkSync(file.path);

    console.log("✅ Recording uploaded to Google Drive:", {
      fileId: driveResponse.data.id,
      name: driveResponse.data.name,
      size: driveResponse.data.size,
    });

    res.json({
      success: true,
      message: "Recording uploaded successfully",
      fileId: driveResponse.data.id,
      fileName: driveResponse.data.name,
      fileSize: driveResponse.data.size,
      viewLink: driveResponse.data.webViewLink,
    });
  } catch (error) {
    console.error("❌ Recording upload failed:", error);

    // Clean up local file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: "Failed to upload recording",
      error: error.message,
    });
  }
});

// List recordings for a user
router.get("/list/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const drive = initializeGoogleDrive();
    if (!drive) {
      throw new Error("Google Drive not configured");
    }

    const query = `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and description contains '${userId}'`;

    const response = await drive.files.list({
      q: query,
      fields: "files(id,name,size,createdTime,webViewLink,description)",
      orderBy: "createdTime desc",
    });

    res.json({
      success: true,
      recordings: response.data.files,
    });
  } catch (error) {
    console.error("❌ Failed to list recordings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to list recordings",
      error: error.message,
    });
  }
});

// Download recording by ID
router.get("/download/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;

    const drive = initializeGoogleDrive();
    if (!drive) {
      throw new Error("Google Drive not configured");
    }

    // Get file metadata
    const fileMetadata = await drive.files.get({
      fileId: fileId,
      fields: "name,mimeType",
    });

    // Get file content
    const response = await drive.files.get(
      {
        fileId: fileId,
        alt: "media",
      },
      { responseType: "stream" }
    );

    // Set headers for download
    res.setHeader("Content-Type", fileMetadata.data.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileMetadata.data.name}"`
    );

    // Pipe the file stream to response
    response.data.pipe(res);
  } catch (error) {
    console.error("❌ Failed to download recording:", error);
    res.status(500).json({
      success: false,
      message: "Failed to download recording",
      error: error.message,
    });
  }
});

module.exports = router;
