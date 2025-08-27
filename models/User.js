const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ["platformadmin", "owner", "admin", "agent"],
    required: true,
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: function () {
      return this.role !== "platformadmin"; // Platform admin doesn't belong to any organization
    },
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
  activeToken: { type: String, default: null }, // New: For single session
  // User profile info
  firstName: {
    type: String,
    trim: true,
  },
  lastName: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    unique: true,
    sparse: true, // Allows null but enforces uniqueness when present
  },
  phone: {
    type: String,
  },
  // User status and permissions
  isActive: {
    type: Boolean,
    default: true,
  },
  permissions: {
    canUploadNumbers: {
      type: Boolean,
      default: false,
    },
    canManageUsers: {
      type: Boolean,
      default: false,
    },
    canViewReports: {
      type: Boolean,
      default: false,
    },
    canManageSettings: {
      type: Boolean,
      default: false,
    },
  },
  // Device fingerprint for platform admin security
  deviceFingerprint: {
    type: String,
    default: null,
    // Only required for platform admin accounts
  },
  deviceInfo: {
    hostname: String,
    platform: String,
    cpu: String,
    memory: String,
    networkInterface: String,
    registeredAt: Date,
  },
  lastDeviceCheck: {
    type: Date,
    default: null,
  },
});

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!passwordRegex.test(this.password)) {
    console.error("Password validation failed:", this.password); // Debug
    throw new Error(
      "Password must be at least 8 characters, with uppercase, lowercase, number, and special character."
    );
  }
  this.password = await bcrypt.hash(this.password, 10);
  console.log("Password hashed for user:", this.username); // Debug
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("User", userSchema);
