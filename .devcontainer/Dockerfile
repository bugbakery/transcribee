FROM ubuntu

RUN apt-get update && apt-get install -y xz-utils curl sudo git
RUN echo "%ubuntu ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

USER ubuntu
WORKDIR /home/ubuntu

# install nix
RUN curl --proto '=https' --tlsv1.2 -L https://nixos.org/nix/install > install-nix.sh
RUN sh install-nix.sh --no-daemon --yes
ENV PATH=$PATH:/home/ubuntu/.nix-profile/bin

# enable flakes
RUN mkdir -p ~/.config/nix/
RUN echo "experimental-features = nix-command flakes" > .config/nix/nix.conf

# make bash use nix dev env
RUN sudo sh -c 'echo ". <(nix print-dev-env)" >> /etc/bash.bashrc'

WORKDIR /workspace
