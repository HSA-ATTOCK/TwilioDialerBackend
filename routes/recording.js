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
    // Parse the service account key from environment variable
    const serviceAccountKey = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);

    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey, // Use credentials object instead of keyFile
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    return google.drive({ version: "v3", auth });
  } catch (error) {
    console.error("Failed to initialize Google Drive:", error);
    console.error("Error details:", error.message);
    return null;
  }
};

// Upload recording to Google Drive
router.post("/upload", upload.single("recording"), async (req, res) => {
  try {
    console.log("🎙️ Recording upload request received");
    console.log("Request body:", req.body);
    console.log(
      "Request file:",
      req.file
        ? {
            originalname: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
          }
        : "No file"
    );

    const { phoneNumber, userId } = req.body;
    const file = req.file;

    if (!file) {
      console.error("❌ No recording file provided");
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

    // Check Google Drive configuration
    if (!GOOGLE_DRIVE_FOLDER_ID) {
      console.error("❌ GOOGLE_DRIVE_FOLDER_ID not configured");
      throw new Error("Google Drive folder ID not configured");
    }

    if (!GOOGLE_SERVICE_ACCOUNT_KEY) {
      console.error("❌ GOOGLE_SERVICE_ACCOUNT_KEY not configured");
      throw new Error("Google Drive service account key not configured");
    }

    // Initialize Google Drive
    console.log("🔧 Initializing Google Drive...");
    const drive = initializeGoogleDrive();
    if (!drive) {
      console.error("❌ Failed to initialize Google Drive");
      throw new Error("Google Drive not configured");
    }

    console.log("✅ Google Drive initialized successfully");

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
