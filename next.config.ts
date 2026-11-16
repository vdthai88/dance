import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets Next dev serve the app to devices on this local Wi-Fi network.
  allowedDevOrigins: ["192.168.86.162"],
};

export default nextConfig;
