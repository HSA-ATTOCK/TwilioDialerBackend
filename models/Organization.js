const mongoose = require("mongoose");

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 50,
    },
    description: {
      type: String,
      maxlength: 200,
    },
    // Organization contact details
    email: {
      type: String,
      required: true,
      unique: true,
    },
    phone: {
      type: String,
      required: true,
    },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String,
    },
    // Organization settings
    settings: {
      timezone: {
        type: String,
        default: "UTC",
      },
      dateFormat: {
        type: String,
        default: "MM/DD/YYYY",
      },
      currency: {
        type: String,
        default: "USD",
      },
      maxUsers: {
        type: Number,
        default: 50, // Default limit for users in organization
      },
      maxAgents: {
        type: Number,
        default: 25, // Default limit for agents
      },
    },
    // Subscription/billing info (for future use)
    subscription: {
      plan: {
        type: String,
        enum: ["free", "basic", "premium", "enterprise"],
        default: "free",
      },
      status: {
        type: String,
        enum: ["active", "inactive", "suspended"],
        default: "active",
      },
      expiresAt: Date,
    },
    // Organization status
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // System admin who created this organization
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
organizationSchema.index({ name: 1 });
organizationSchema.index({ email: 1 });
organizationSchema.index({ isActive: 1 });

module.exports = mongoose.model("Organization", organizationSchema);
