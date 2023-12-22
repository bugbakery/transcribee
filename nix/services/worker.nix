{ config, pkgs, lib, options, ... }:
with lib;
let
  cfg = config.services.transcribee-worker;
  worker = (pkgs.callPackage ../pkgs/worker.nix {});
in
{
  options.services.transcribee-worker = {
    enable = mkEnableOption "transcribee worker";
    token = mkOption {
      type = types.str;
    };
    coordinator = mkOption {
      type = types.str;
    };
    modelsDir = mkOption {
      type = types.str;
    };
  };

  config = mkIf cfg.enable {
    systemd.services.transcribee-worker = {
      enable = true;
      serviceConfig = {
        TimeoutStopSec = "infinity";
        Restart = "always";
      };
      script = ''
        # add native libs to LD_LIBRARY_PATH
        # FIXME: why do we need this? there should be a better way to do this
        for lib_path in $(${pkgs.fd}/bin/fd "\\.libs" "${worker}/__pypackages__" --type=d);
        do
          export LD_LIBRARY_PATH="$LD_LIBRARY_PATH:$lib_path"
        done

        ${pkgs.pdm}/bin/pdm run -s -p ${worker} ${worker}/run.py --coordinator ${cfg.coordinator} --token ${cfg.token}
      '';
      environment = {
        LD_LIBRARY_PATH = "${pkgs.stdenv.cc.cc.lib}/lib";
        MODELS_DIR = cfg.modelsDir;
        CPU_THREADS = "8";
      };
      path = [ pkgs.ffmpeg.bin ];
      wantedBy = [ "multi-user.target" ];
    };
  };
}
