import { NextRequest, NextResponse } from "next/server";
import piexif from "piexifjs";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ExifMetadata {
  prompt?: string;
  negativePrompt?: string;
  parameters?: string;
  notes?: string;
  comment?: string;
  description?: string;
  userComment?: string;
  [key: string]: string | undefined;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const allowedMimeTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedMimeTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Only PNG, JPEG, and WebP files are supported" },
        { status: 400 },
      );
    }

    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File size exceeds 50MB limit" },
        { status: 400 },
      );
    }

    const buffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    const exifMetadata: ExifMetadata = {};

    // Only try piexif if it might be a JPEG/TIFF, as it crashes easily on large PNGs
    const isPNG =
      uint8Array.length > 8 &&
      uint8Array[0] === 0x89 &&
      uint8Array[1] === 0x50 &&
      uint8Array[2] === 0x4e &&
      uint8Array[3] === 0x47;

    if (!isPNG) {
      try {
        // Safe conversion of uint8array to binary string, avoiding Maximum Call Stack Size Exceeded
        const chunk = uint8Array.slice(0, Math.min(uint8Array.length, 1024 * 1024));
        const binaryString = Buffer.from(chunk).toString("binary");
        
        const exifDict = piexif.load(binaryString);

        const exifFieldsToCheck = [
          [piexif.ImageIFD.ImageDescription, "description"],
          [piexif.ImageIFD.XPComment, "userComment"],
          [piexif.ImageIFD.XPKeywords, "keywords"],
          [37510, "comment"], // UserComment is 37510
        ];

        for (const [tag, key] of exifFieldsToCheck) {
          // Check both 0th and Exif IFD
          let value = null;
          if (exifDict["0th"] && exifDict["0th"][tag as number]) {
            value = exifDict["0th"][tag as number];
          } else if (exifDict["Exif"] && exifDict["Exif"][tag as number]) {
            value = exifDict["Exif"][tag as number];
          }

          if (value) {
            // piexif can return arrays for strings depending on the tag type, or raw strings
            let strValue = Array.isArray(value) ? value[0] : value;
            
            if (typeof strValue === "string") {
              // UserComments often start with a character code prefix like "UNICODE\0" or "ASCII\0\0\0"
              strValue = strValue.replace(/^(UNICODE|ASCII)\x00+/ig, "");
              // Also remove any remaining null bytes (common in UTF16LE parsed as ASCII)
              strValue = strValue.replace(/\x00/g, "");
              exifMetadata[key] = strValue.trim();
            }
          }
        }
      } catch (exifError) {
        console.debug("EXIF parsing failed");
      }
    }

    if (isPNG || file.type === "image/png") {
      try {
        const pngMetadata = extractPNGMetadata(uint8Array);
        Object.assign(exifMetadata, pngMetadata);
      } catch (pngError) {
        console.debug("PNG metadata extraction failed:", pngError);
      }
    }

    let foundPrompt =
      exifMetadata.prompt ||
      exifMetadata.parameters ||
      exifMetadata.comment ||
      exifMetadata.userComment ||
      exifMetadata.description ||
      "";

    // Clean up typical A1111/Forge injected metadata formats
    if (foundPrompt) {
      const negMatch = foundPrompt.match(/negative prompt:/i);
      if (negMatch && negMatch.index !== undefined) {
        foundPrompt = foundPrompt.substring(0, negMatch.index).trim();
      }
      const stepsMatch = foundPrompt.match(/\nsteps:/i);
      if (stepsMatch && stepsMatch.index !== undefined) {
        foundPrompt = foundPrompt.substring(0, stepsMatch.index).trim();
      }
    }

    return NextResponse.json({
      success: true,
      prompt: foundPrompt,
      metadata: exifMetadata,
      fileInfo: {
        name: file.name,
        type: file.type,
        size: file.size,
      },
    });
  } catch (error) {
    console.error("Error extracting EXIF:", error);
    return NextResponse.json(
      { error: "Failed to extract metadata from image" },
      { status: 500 },
    );
  }
}

function extractPNGMetadata(uint8Array: Uint8Array): ExifMetadata {
  const metadata: ExifMetadata = {};

  const textDecoder = new TextDecoder("utf-8");
  const latin1Decoder = new TextDecoder("iso-8859-1");

  let offset = 8;

  while (offset < uint8Array.length) {
    const length = readUInt32BE(uint8Array, offset);
    offset += 4;

    const chunkType = String.fromCharCode(
      uint8Array[offset],
      uint8Array[offset + 1],
      uint8Array[offset + 2],
      uint8Array[offset + 3],
    );
    offset += 4;

    if (chunkType === "tEXt") {
      const chunkData = uint8Array.slice(offset, offset + length);
      const nullIndex = chunkData.indexOf(0);

      if (nullIndex > 0) {
        const keyword = latin1Decoder.decode(chunkData.slice(0, nullIndex));
        const text = textDecoder.decode(chunkData.slice(nullIndex + 1));
        const keyLower = keyword.toLowerCase();

        if (keyLower === "generation_data") {
          try {
            const data = JSON.parse(text);
            if (data.prompt) metadata.prompt = data.prompt;
            if (data.negativePrompt)
              metadata.negativePrompt = data.negativePrompt;
            metadata.generation_data = text;
          } catch (e) {}
        } else if (
          keyLower === "prompt" &&
          text.startsWith("{") &&
          text.includes('"class_type"')
        ) {
          try {
            const data = JSON.parse(text);
            
            // Try to identify positive/negative nodes from KSampler
            let posNodeId = null;
            let negNodeId = null;
            
            for (const key in data) {
              const node = data[key];
              if (node.class_type && node.class_type.startsWith("KSampler")) {
                if (Array.isArray(node.inputs?.positive)) posNodeId = node.inputs.positive[0];
                if (Array.isArray(node.inputs?.negative)) negNodeId = node.inputs.negative[0];
              }
            }

            let comfyPrompt = "";
            
            // If we found positive node, extract only from there (we might need to traverse conditioning nodes, but mostly it's CLIPTextEncode directly)
            if (posNodeId && data[posNodeId] && data[posNodeId].class_type.startsWith("CLIPTextEncode")) {
              comfyPrompt = data[posNodeId].inputs?.text || "";
            } else {
              // Fallback if we couldn't find KSampler or it was complex:
              // Just take the first CLIPTextEncode we see and assume it's positive
              for (const key in data) {
                const node = data[key];
                if (
                  node.class_type === "CLIPTextEncode" ||
                  node.class_type === "CLIPTextEncodeSDXL"
                ) {
                  const nodeText = node.inputs?.text;
                  if (typeof nodeText === "string") {
                    comfyPrompt = nodeText; // Stop at first to avoid negative
                    break;
                  }
                }
              }
            }

            if (comfyPrompt && !metadata.prompt) {
              metadata.prompt = comfyPrompt;
            } else if (!metadata.prompt) {
              metadata.prompt = text;
            }
          } catch (e) {
            if (!metadata.prompt) metadata.prompt = text;
          }
        } else {
          if (keyLower.includes("prompt") && !metadata.prompt) {
            metadata.prompt = text;
          } else if (
            keyLower.includes("negative") &&
            !metadata.negativePrompt
          ) {
            metadata.negativePrompt = text;
          } else if (keyLower.includes("parameter") && !metadata.parameters) {
            metadata.parameters = text;
          } else if (
            keyLower.includes("description") &&
            !metadata.description
          ) {
            metadata.description = text;
          } else if (keyLower.includes("comment") && !metadata.comment) {
            metadata.comment = text;
          }
        }
      }
    }

    if (chunkType === "iTXt") {
      try {
        const chunkData = uint8Array.slice(offset, offset + length);
        const nullIndex = chunkData.indexOf(0);

        if (nullIndex > 0) {
          const keyword = latin1Decoder.decode(chunkData.slice(0, nullIndex));
          const compressionFlag = chunkData[nullIndex + 1];

          if (compressionFlag === 0) {
            const nullIndex2 = chunkData.indexOf(0, nullIndex + 3);
            const textOffset = nullIndex2 > 0 ? nullIndex2 + 1 : nullIndex + 3;
            const text = textDecoder.decode(chunkData.slice(textOffset));

            const keyLower = keyword.toLowerCase();
            if (keyLower.includes("prompt") && !metadata.prompt) {
              metadata.prompt = text;
            } else if (keyLower === "description" && !metadata.description) {
              metadata.description = text;
            }
          }
        }
      } catch (error) {}
    }

    offset += length + 4;
  }

  return metadata;
}

function readUInt32BE(buffer: Uint8Array, offset: number): number {
  return (
    ((buffer[offset] << 24) |
      (buffer[offset + 1] << 16) |
      (buffer[offset + 2] << 8) |
      buffer[offset + 3]) >>>
    0
  );
}
