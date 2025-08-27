const mongoose = require("mongoose");

const dialListSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    // Remove global unique constraint, make it unique per organization
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true, // Which user/agent this number is assigned to
  },
  dialingStatus: {
    type: String,
    enum: ["pending", "dialing", "completed", "failed", "busy", "no_answer"],
    default: "pending",
  },
  disposition: {
    type: String,
    default: null,
  },
  notes: {
    type: String,
    default: null,
  },
  comments: {
    type: String,
    default: null, // For additional call comments from agents
  },
  attempts: {
    type: Number,
    default: 0,
  },
  lastDialedAt: {
    type: Date,
    default: null,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  currentlyDialingBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null, // Tracks who is currently dialing this number
  },
  priority: {
    type: Number,
    default: 1, // For future priority-based dialing
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt field before saving
dialListSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Index for better query performance
dialListSchema.index({ assignedTo: 1, dialingStatus: 1 });
dialListSchema.index({ organizationId: 1, phoneNumber: 1 }, { unique: true }); // Unique per organization
dialListSchema.index({ organizationId: 1, assignedTo: 1 });
dialListSchema.index({ currentlyDialingBy: 1 });

module.exports = mongoose.model("DialList", dialListSchema);
