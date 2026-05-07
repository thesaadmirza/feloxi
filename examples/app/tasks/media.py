import random
import time

from app import app


@app.task(name="tasks.media.resize_image", bind=True, max_retries=2)
def resize_image(self, image_url: str, sizes: list):
    time.sleep(random.uniform(0.5, 3.0))

    if random.random() < 0.05:
        raise IOError(f"Failed to fetch image: {image_url}")

    return {
        "source": image_url,
        "outputs": [{"size": s, "url": f"{image_url}@{s}"} for s in sizes],
    }


@app.task(name="tasks.media.transcode_video", bind=True, max_retries=1)
def transcode_video(self, video_url: str, formats: list):
    time.sleep(random.uniform(5.0, 20.0))

    if random.random() < 0.08:
        raise RuntimeError(f"Transcoding failed for {video_url}: codec error")

    return {
        "source": video_url,
        "outputs": [{"format": f, "url": f"{video_url}.{f}"} for f in formats],
    }


@app.task(name="tasks.media.generate_thumbnail", bind=True, max_retries=2)
def generate_thumbnail(self, video_url: str, timestamp_secs: float = 0.0):
    time.sleep(random.uniform(0.3, 1.5))

    return {
        "source": video_url,
        "thumbnail": f"{video_url}_thumb_{int(timestamp_secs)}s.jpg",
    }
