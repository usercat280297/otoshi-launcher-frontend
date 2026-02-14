import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SignedLicense } from "../types";

export async function getHardwareId(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  return invoke<string>("get_hardware_id");
}

export async function validateLicense(licenseJson: string): Promise<SignedLicense | null> {
  if (!isTauri()) {
    return null;
  }
  return invoke<SignedLicense>("validate_license", { licenseJson });
}
