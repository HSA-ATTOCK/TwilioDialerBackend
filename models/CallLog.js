const mongoose = require("mongoose");

const callLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Agent who made the call
  phoneNumber: { type: String, required: true },
  type: { type: String, enum: ["manual", "auto"], required: true },
  startTime: Date,
  ringTime: Date,
  answerTime: Date,
  endTime: Date,
  duration: Number, // In seconds
  licenseAgentDuration: Number, // If conference
  disposition: {
    type: String,
    enum: [
      "Interested",
      "Not Interested",
      "Answering Machine",
      "Dead Air",
      "No Answer",
      "Call Back",
      "DNC",
    ],
  },
  notes: String,
  status: {
    type: String,
    enum: ["connecting", "ringing", "on_call", "on_hold", "ended"],
  },
  endedBy: String, // Who ended (agent, client, etc.)
  auditAction: String, // e.g., "Call Started", "Disposition Set"
});

module.exports = mongoose.model("CallLog", callLogSchema);
