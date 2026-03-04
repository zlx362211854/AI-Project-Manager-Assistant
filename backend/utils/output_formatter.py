import os
from pathlib import Path


def save_output(content: str, filename: str, output_dir: str = "output") -> str:
    """
    Save generated output to a file.

    @param content: The content string to save
    @param filename: Name of the output file
    @param output_dir: Directory to save the file in
    @returns: Full path to the saved file
    """
    path = Path(output_dir)
    path.mkdir(parents=True, exist_ok=True)

    filepath = path / filename
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

    return str(filepath)
