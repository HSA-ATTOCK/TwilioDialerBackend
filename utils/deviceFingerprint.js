// Device fingerprinting utility for platform admin security
const crypto = require("crypto");
const os = require("os");

class DeviceFingerprint {
  /**
   * Generate a unique device fingerprint based on hardware characteristics
   */
  static generateFingerprint() {
    const networkInterfaces = os.networkInterfaces();
    const cpus = os.cpus();

    // Get MAC addresses (most stable identifier)
    const macAddresses = [];
    for (const interfaceName in networkInterfaces) {
      const networkInterface = networkInterfaces[interfaceName];
      for (const net of networkInterface) {
        if (net.mac && net.mac !== "00:00:00:00:00:00") {
          macAddresses.push(net.mac);
        }
      }
    }

    // Get CPU information
    const cpuModel = cpus[0] ? cpus[0].model : "";
    const cpuSpeed = cpus[0] ? cpus[0].speed : 0;
    const cpuCores = cpus.length;

    // Get system information
    const platform = os.platform();
    const arch = os.arch();
    const hostname = os.hostname();
    const totalMemory = os.totalmem();

    // Create fingerprint components
    const fingerprintData = {
      macAddresses: macAddresses.sort(), // Sort for consistency
      cpuModel,
      cpuSpeed,
      cpuCores,
      platform,
      arch,
      hostname,
      totalMemory,
    };

    // Generate hash from fingerprint data
    const fingerprintString = JSON.stringify(fingerprintData);
    const fingerprint = crypto
      .createHash("sha256")
      .update(fingerprintString)
      .digest("hex");

    return {
      fingerprint,
      components: fingerprintData,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validate if current device matches stored fingerprint
   */
  static validateFingerprint(storedFingerprint) {
    const currentFingerprint = this.generateFingerprint();
    return currentFingerprint.fingerprint === storedFingerprint;
  }

  /**
   * Generate a user-friendly device description
   */
  static getDeviceDescription() {
    const cpus = os.cpus();
    const networkInterfaces = os.networkInterfaces();

    // Get primary network interface
    let primaryInterface = "Unknown";
    for (const interfaceName in networkInterfaces) {
      const nets = networkInterfaces[interfaceName];
      for (const net of nets) {
        if (!net.internal && net.family === "IPv4") {
          primaryInterface = interfaceName;
          break;
        }
      }
      if (primaryInterface !== "Unknown") break;
    }

    return {
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.arch()}`,
      cpu: cpus[0] ? `${cpus[0].model} (${cpus.length} cores)` : "Unknown CPU",
      memory: `${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB`,
      networkInterface: primaryInterface,
      uptime: Math.round(os.uptime() / 3600), // hours
    };
  }
}

module.exports = DeviceFingerprint;
