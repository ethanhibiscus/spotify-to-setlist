# 🎵 Spotify to Setlist

This project extracts **BPM, key, duration, and energy** from **Spotify playlists or individual tracks** using the **Tunebat API**. 

## 📌 Features
- Fetches **track metadata** from Spotify.
- Uses **Tunebat API** for **BPM, key, duration, and energy**.
- **Batch processing** with retry logic to handle API rate limits.
- **Submodule integration** for `tunebat-api`.

---

## 🚀 Installation & Setup

### **1. Clone the Repository**
Since `tunebat-api` is a **submodule**, clone the repository with: 

```bash
git clone --recurse-submodules https://github.com/YOUR_USERNAME/spotify-to-setlist.git
