const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["owner", "admin", "agent"], required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
  activeToken: { type: String, default: null }, // New: For single session
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
