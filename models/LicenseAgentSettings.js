const mongoose = require("mongoose");

const licenseAgentSettingsSchema = new mongoose.Schema(
  {
    ownerId: {
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
    agents: [
      {
        id: { type: String, required: true }, // agent1, agent2, agent3
        name: { type: String, required: true }, // Button display name
        phoneNumber: { type: String, required: true }, // Agent's phone number
        isActive: { type: Boolean, default: true },
      },
    ],
    holdMusicEnabled: {
      type: Boolean,
      default: true,
    },
    holdMusicUrl: {
      type: String,
      default: null, // Optional custom hold music URL
    },
  },
  {
    timestamps: true,
  }
);

// Default settings for new owners
licenseAgentSettingsSchema.statics.createDefault = async function (ownerId) {
  const defaultSettings = {
    ownerId,
    agents: [
      {
        id: "agent1",
        name: "License Agent 1",
        phoneNumber: "+1234567890",
        isActive: true,
      },
      {
        id: "agent2",
        name: "License Agent 2",
        phoneNumber: "+1234567891",
        isActive: true,
      },
      {
        id: "agent3",
        name: "License Agent 3",
        phoneNumber: "+1234567892",
        isActive: true,
      },
    ],
  };

  try {
    const settings = new this(defaultSettings);
    await settings.save();
    return settings;
  } catch (error) {
    console.error("Error creating default license agent settings:", error);
    throw error;
  }
};

module.exports = mongoose.model(
  "LicenseAgentSettings",
  licenseAgentSettingsSchema
);
