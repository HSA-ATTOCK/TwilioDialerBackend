const express = require("express");
const multer = require("multer");
const { google } = require("googleapis");
const fs = require("fs");
const router = express.Router();

// Configure multer for file upload
const upload = multer({
  dest: "uploads/recordings/",
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(new Error("Only audio files are allowed"), false);
  },
});

// Google Drive configuration
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

// Initialize Google Drive API
const initializeGoogleDrive = () => {
  try {
    const serviceAccountKey = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);

    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    return google.drive({ version: "v3", auth });
  } catch (error) {
    console.error("Failed to initialize Google Drive:", error.message);
    return null;
  }
};

// Upload recording to Google Drive
router.post("/upload", upload.single("recording"), async (req, res) => {
  try {
    const { phoneNumber, userId } = req.body;
    const file = req.file;

    if (!file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    if (!GOOGLE_DRIVE_FOLDER_ID || !GOOGLE_SERVICE_ACCOUNT_KEY) {
      throw new Error("Google Drive not configured");
    }

    const drive = initializeGoogleDrive();
    if (!drive) throw new Error("Google Drive init failed");

    // Metadata for file
    const fileMetadata = {
      name: file.originalname,
      parents: [GOOGLE_DRIVE_FOLDER_ID],
      description: `Call recording for ${phoneNumber} by user ${userId}`,
    };

    // Media stream
    const media = {
      mimeType: file.mimetype,
      body: fs.createReadStream(file.path),
    };

    // Upload with support for all drives
    const driveResponse = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: "id,name,size,webViewLink",
      supportsAllDrives: true, // ✅ important
    });

    fs.unlinkSync(file.path); // remove local temp file

    res.json({
      success: true,
      message: "Recording uploaded successfully",
      fileId: driveResponse.data.id,
      fileName: driveResponse.data.name,
      fileSize: driveResponse.data.size,
      viewLink: driveResponse.data.webViewLink,
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

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
    if (!drive) throw new Error("Google Drive not configured");

    const query = `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and description contains '${userId}'`;

    const response = await drive.files.list({
      q: query,
      fields: "files(id,name,size,createdTime,webViewLink,description)",
      orderBy: "createdTime desc",
      includeItemsFromAllDrives: true, // ✅ include shared + my drive
      supportsAllDrives: true, // ✅ required for shared drive
    });

    res.json({ success: true, recordings: response.data.files });
  } catch (error) {
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
    if (!drive) throw new Error("Google Drive not configured");

    const fileMetadata = await drive.files.get({
      fileId,
      fields: "name,mimeType",
      supportsAllDrives: true, // ✅
    });

    const response = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true }, // ✅
      { responseType: "stream" }
    );

    res.setHeader("Content-Type", fileMetadata.data.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileMetadata.data.name}"`
    );

    response.data.pipe(res);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to download recording",
      error: error.message,
    });
  }
});

module.exports = router;
