const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const CallLog = require("../models/CallLog");
const DialList = require("../models/DialList");
const router = express.Router();
const upload = multer({ dest: "uploads/" });

// Upload spreadsheet for auto dial
router.post("/upload-list", upload.single("file"), (req, res) => {
  const numbers = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (row) => numbers.push({ phoneNumber: row.phoneNumber })) // Assume CSV has 'phoneNumber' column
    .on("end", async () => {
      const list = new DialList({ adminId: req.body.adminId, numbers });
      await list.save();
      fs.unlinkSync(req.file.path); // Clean up
      res.json({ success: true, listId: list._id });
    });
});

// Set Disposition
router.post("/disposition", async (req, res) => {
  const { callId, disposition, notes } = req.body;
  await CallLog.findByIdAndUpdate(callId, { disposition, notes });
  res.json({ success: true });
});

// Get Reports (filter by user/role)
router.get("/reports", async (req, res) => {
  const logs = await CallLog.find({
    /* filter by role */
  });
  res.json(logs);
});
// Export to CSV (new)
router.get("/export-csv", async (req, res) => {
  const logs = await CallLog.find();
  // Use csv-stringify or manual to generate CSV
  res.setHeader("Content-Type", "text/csv");
  res.send(
    "id,phoneNumber,duration,disposition\n" +
      logs
        .map(
          (log) =>
            `${log._id},${log.phoneNumber},${log.duration},${log.disposition}`
        )
        .join("\n")
  );
});
module.exports = router;
