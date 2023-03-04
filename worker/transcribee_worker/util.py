import librosa
from transcribee_worker.config import SAMPLE_RATE


def load_audio(path):
    audio, sr = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    return audio
