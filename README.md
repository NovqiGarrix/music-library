# Music Library API

ByteMusic - A free forever music library. This repository contains the API for
the ByteMusic music library. Built with Deno and Hono.

## Getting Started

### Prerequisites

- **yt-dlp**\
  You can install yt-dlp via Python's package manager:
  ```
  pip install yt-dlp
  ```
  Alternatively, download the latest binary from the
  [yt-dlp GitHub releases](https://github.com/yt-dlp/yt-dlp/releases).

- **FFmpeg**\
  Install FFmpeg using your system’s package manager. For example:
  - **macOS/Homebrew:**
    ```
    brew install ffmpeg
    ```
  - **Ubuntu/Debian:**
    ```
    sudo apt update && sudo apt install ffmpeg
    ```
  - **Windows:**\
    Download FFmpeg from the
    [official FFmpeg website](https://ffmpeg.org/download.html) and follow the
    installation instructions.

### Installation

1. Clone the repository:
   ```bash
   git clone
   ```

2. Navigate to the project directory:
   ```bash
   cd music-library
   ```

3. Install the required dependencies: Follow the instructions in the
   ##prerequisites section to install the required dependencies.

4. Run the application: After installing dependencies, you can start the
   application using the following command:
   ```bash
   deno task dev
   ```
