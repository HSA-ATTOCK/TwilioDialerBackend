const mongoose = require("mongoose");

const userStatusSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
  },
  isLoggedIn: {
    type: Boolean,
    default: false,
  },
  isOnCall: {
    type: Boolean,
    default: false,
  },
  currentCallStartTime: {
    type: Date,
    default: null,
  },
  currentCallNumber: {
    type: String,
    default: null,
  },
  autoDialerStatus: {
    type: String,
    enum: ["stopped", "running", "paused"],
    default: "stopped",
  },
  lastActivity: {
    type: Date,
    default: Date.now,
  },
  callStatus: {
    type: String,
    enum: ["idle", "dialing", "ringing", "connected", "on_hold"],
    default: "idle",
  },
  deviceStatus: {
    type: String,
    enum: ["offline", "ready", "busy", "unavailable"],
    default: "offline",
  },
  lastLoginTime: {
    type: Date,
    default: null,
  },
  lastLogoutTime: {
    type: Date,
    default: null,
  },
  totalCallsToday: {
    type: Number,
    default: 0,
  },
  totalCallTimeToday: {
    type: Number, // in seconds
    default: 0,
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
userStatusSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  this.lastActivity = new Date();
  next();
});

// Index for better query performance
userStatusSchema.index({ userId: 1 });
userStatusSchema.index({ isLoggedIn: 1 });
userStatusSchema.index({ isOnCall: 1 });

module.exports = mongoose.model("UserStatus", userStatusSchema);
