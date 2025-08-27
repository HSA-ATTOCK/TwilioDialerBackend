const mongoose = require("mongoose");

const callLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    phoneNumber: { type: String, required: true },
    type: { type: String, enum: ["manual", "auto"], required: true },
    startTime: { type: Date, default: Date.now },
    ringTime: Date,
    answerTime: Date,
    endTime: Date,
    duration: { type: Number, default: 0 }, // In seconds
    licenseAgentDuration: { type: Number, default: 0 }, // If conference
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
    recordingUrl: {
      type: String, // Google Drive URL
      default: null,
    },
    recordingId: {
      type: String, // Google Drive file ID
      default: null,
    },
    twilioCallSid: {
      type: String, // Twilio call SID for reference
      default: null,
    },
    status: {
      type: String,
      enum: ["connecting", "ringing", "on_call", "on_hold", "ended"],
      default: "connecting",
    },
    endedBy: String,
    auditAction: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Add index for better query performance
callLogSchema.index({ userId: 1, startTime: -1 });
callLogSchema.index({ organizationId: 1, startTime: -1 });
callLogSchema.index({ phoneNumber: 1 });
callLogSchema.index({ twilioCallSid: 1 });

module.exports = mongoose.model("CallLog", callLogSchema);
