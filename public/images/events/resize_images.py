#!/usr/bin/env python3
"""
Image Resizer Script
Resizes all images in the current directory to a specified width while maintaining aspect ratio.
"""

import os
from PIL import Image
import argparse


def resize_image(image_path, target_width, output_dir=None):
    """
    Resize an image to the target width while maintaining aspect ratio.

    Args:
        image_path: Path to the input image
        target_width: Desired width in pixels
        output_dir: Output directory (if None, saves in same directory with suffix)
    """
    try:
        with Image.open(image_path) as img:
            # Calculate new height maintaining aspect ratio
            aspect_ratio = img.height / img.width
            target_height = int(target_width * aspect_ratio)

            # Resize the image
            resized_img = img.resize(
                (target_width, target_height), Image.Resampling.LANCZOS
            )

            # Generate output filename
            filename, ext = os.path.splitext(os.path.basename(image_path))
            if output_dir:
                output_path = os.path.join(output_dir, f"{filename}_resized{ext}")
            else:
                output_path = f"{filename}_resized{ext}"

            # Save the resized image
            resized_img.save(output_path, quality=95, optimize=True)
            print(
                f"✓ Resized: {os.path.basename(image_path)} -> {os.path.basename(output_path)}"
            )

    except Exception as e:
        print(f"✗ Error processing {os.path.basename(image_path)}: {str(e)}")


def main():
    # Set up command line arguments
    parser = argparse.ArgumentParser(
        description="Resize all images in current directory"
    )
    # Default width set to 600 if not provided
    parser.add_argument(
        "width",
        nargs="?",
        type=int,
        default=600,
        help="Target width in pixels (e.g., 300). Defaults to 600",
    )
    parser.add_argument("--output-dir", "-o", help="Output directory (optional)")

    args = parser.parse_args()

    # Supported image formats
    supported_formats = (".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tiff", ".webp")

    # Get all image files in current directory
    current_dir = os.getcwd()
    image_files = [
        f for f in os.listdir(current_dir) if f.lower().endswith(supported_formats)
    ]

    if not image_files:
        print("No image files found in the current directory.")
        return

    # Create output directory if specified
    if args.output_dir and not os.path.exists(args.output_dir):
        os.makedirs(args.output_dir)

    print(f"Found {len(image_files)} image(s). Resizing to width: {args.width}px")
    print("-" * 50)

    # Process each image
    for image_file in image_files:
        image_path = os.path.join(current_dir, image_file)

        try:
            with Image.open(image_path) as img:
                if img.width <= args.width:
                    print(f"• Skipped (<= target width): {image_file} ({img.width}px)")
                    continue

                aspect_ratio = img.height / img.width
                target_height = int(args.width * aspect_ratio)
                resized_img = img.resize(
                    (args.width, target_height), Image.Resampling.LANCZOS
                )
                resized_img.save(image_path, quality=100, optimize=True)
                print(f"✓ Resized (overwritten): {image_file}")
        except Exception as e:
            print(f"✗ Error processing {image_file}: {str(e)}")

    print("-" * 50)
    print("Resizing complete!")


if __name__ == "__main__":
    main()
