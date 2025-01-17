from abc import ABC, abstractmethod
from argparse import ArgumentParser


class Command(ABC):
    def __init__(self):
        pass

    @abstractmethod
    def configure_parser(self, parser: ArgumentParser):
        pass

    @abstractmethod
    def run(self, args):
        pass
