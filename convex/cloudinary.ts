/**
 * Cloudinary Media Storage for Pipelixr
 *
 * All media files (images, videos, audio, documents) are stored in Cloudinary
 * instead of Convex storage to avoid hitting Convex storage limits.
 *
 * Uses signed uploads via Web Crypto API (SHA-1) — no Node.js dependencies.
 *
 * Required Convex environment variables:
 *   CLOUDINARY_CLOUD_NAME  - Your Cloudinary cloud name
 *   CLOUDINARY_API_KEY     - Cloudinary API key
 *   CLOUDINARY_API_SECRET  - Cloudinary API secret
 */

// ─── Config ──────────────────────────────────────────────────────────────────

type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

export function getCloudinaryConfig(): CloudinaryConfig {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
  const apiKey = process.env.CLOUDINARY_API_KEY || "";
  const apiSecret = process.env.CLOUDINARY_API_SECRET || "";

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must be set in Convex environment variables."
    );
  }

  return { cloudName, apiKey, apiSecret };
}

/** Returns true if all three Cloudinary env vars are set. */
export function isCloudinaryConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

// ─── SHA-1 Signing (Web Crypto API) ──────────────────────────────────────────

async function sha1Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Types ───────────────────────────────────────────────────────────────────

type UploadOptions = {
  /** The MIME type of the file (e.g. "image/jpeg", "audio/ogg", "application/pdf") */
  mimetype: string;
  /** Cloudinary folder (default: "pipelixr/media") */
  folder?: string;
  /** Custom public_id (optional — Cloudinary generates one if omitted) */
  publicId?: string;
  /** Resource type override (default: auto-detected from mimetype) */
  resourceType?: "image" | "video" | "raw" | "auto";
};

type UploadResult = {
  /** Secure HTTPS URL for accessing the file */
  secureUrl: string;
  /** Cloudinary public ID */
  publicId: string;
  /** Resource type used */
  resourceType: string;
  /** File size in bytes */
  bytes: number;
  /** File format */
  format: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Detects the Cloudinary resource type from a MIME type.
 *   image/*       → "image"
 *   video/*       → "video"
 *   audio/*       → "video"  (Cloudinary treats audio as video resource type)
 *   everything else → "raw"  (PDFs, docs, spreadsheets, etc.)
 */
function detectResourceType(mimetype: string): "image" | "video" | "raw" {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "video";
  return "raw";
}

/**
 * Generates the Cloudinary API signature for signed uploads.
 *
 * Cloudinary signature = SHA-1 of all params (sorted alphabetically,
 * excluding file/api_key/resource_type/type) concatenated with "&",
 * then appended with the API secret.
 */
async function generateSignature(
  params: Record<string, string>,
  apiSecret: string
): Promise<string> {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  return sha1Hex(sortedParams + apiSecret);
}

// ─── Upload from base64 ─────────────────────────────────────────────────────

/**
 * Uploads a file to Cloudinary using signed upload from base64 data.
 *
 * @param base64Data - File content as base64 (WITHOUT data URI prefix)
 * @param options    - Upload options (mimetype, folder, etc.)
 * @returns          - Upload result with secure URL and metadata
 */
export async function uploadToCloudinary(
  base64Data: string,
  options: UploadOptions
): Promise<UploadResult> {
  const config = getCloudinaryConfig();
  const resourceType = options.resourceType || detectResourceType(options.mimetype);
  const folder = options.folder || "pipelixr/media";
  const timestamp = Math.floor(Date.now() / 1000);

  // Parameters that go into the signature (alphabetical order)
  const paramsToSign: Record<string, string> = {
    folder,
    timestamp: String(timestamp),
  };
  if (options.publicId) {
    paramsToSign.public_id = options.publicId;
  }

  const signature = await generateSignature(paramsToSign, config.apiSecret);

  // Build the data URI
  const dataUri = `data:${options.mimetype};base64,${base64Data}`;

  // Cloudinary accepts application/x-www-form-urlencoded for uploads
  const formParams = new URLSearchParams();
  formParams.append("file", dataUri);
  formParams.append("api_key", config.apiKey);
  formParams.append("timestamp", String(timestamp));
  formParams.append("signature", signature);
  formParams.append("folder", folder);
  if (options.publicId) {
    formParams.append("public_id", options.publicId);
  }

  const uploadUrl = `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formParams.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Cloudinary upload failed (${res.status}): ${errorText}`);
  }

  const result = await res.json();

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type,
    bytes: result.bytes || 0,
    format: result.format || "",
  };
}

// ─── Upload from URL ─────────────────────────────────────────────────────────

/**
 * Uploads a file to Cloudinary by letting Cloudinary fetch it from a URL.
 * Useful when the media source is a publicly accessible URL.
 *
 * @param fileUrl - Publicly accessible URL of the file
 * @param options - Upload options
 * @returns       - Upload result with secure URL and metadata
 */
export async function uploadToCloudinaryFromUrl(
  fileUrl: string,
  options: UploadOptions
): Promise<UploadResult> {
  const config = getCloudinaryConfig();
  const resourceType = options.resourceType || detectResourceType(options.mimetype);
  const folder = options.folder || "pipelixr/media";
  const timestamp = Math.floor(Date.now() / 1000);

  const paramsToSign: Record<string, string> = {
    folder,
    timestamp: String(timestamp),
  };
  if (options.publicId) {
    paramsToSign.public_id = options.publicId;
  }

  const signature = await generateSignature(paramsToSign, config.apiSecret);

  const formParams = new URLSearchParams();
  formParams.append("file", fileUrl);
  formParams.append("api_key", config.apiKey);
  formParams.append("timestamp", String(timestamp));
  formParams.append("signature", signature);
  formParams.append("folder", folder);
  if (options.publicId) {
    formParams.append("public_id", options.publicId);
  }

  const uploadUrl = `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formParams.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Cloudinary URL upload failed (${res.status}): ${errorText}`);
  }

  const result = await res.json();

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type,
    bytes: result.bytes || 0,
    format: result.format || "",
  };
}
