import { describe, expect, it } from "vitest";
import { syncedDriveOf } from "./synced-drive";

describe("syncedDriveOf", () => {
  it("names the drive that syncs a folder", () => {
    expect(
      syncedDriveOf("/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/Thesis"),
    ).toBe("iCloud Drive");
    expect(
      syncedDriveOf(
        "/Users/ada/Library/CloudStorage/GoogleDrive-ada@example.com/My Drive/Thesis",
      ),
    ).toBe("Google Drive");
    expect(
      syncedDriveOf("/Users/ada/Library/CloudStorage/ProtonDrive-ada@proton.me/Thesis"),
    ).toBe("Proton Drive");
    expect(syncedDriveOf("C:\\Users\\ada\\OneDrive - University\\Thesis")).toBe(
      "OneDrive",
    );
    expect(syncedDriveOf("C:\\Users\\ada\\iCloudDrive\\Thesis")).toBe("iCloud Drive");
    expect(syncedDriveOf("/home/ada/Dropbox/Thesis")).toBe("Dropbox");
  });

  it("leaves other folders alone", () => {
    expect(syncedDriveOf("/Users/ada/Documents/Polemic/Thesis")).toBeNull();
    expect(syncedDriveOf("/home/ada/drive-notes/Thesis")).toBeNull();
  });
});
