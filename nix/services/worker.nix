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

  config = mkIf cfg.enable
    (mkMerge [
      (optionalAttrs (hasAttr "systemd" options) {
        systemd.services.transcribee-worker = {
          enable = true;
          unitConfig = {
            Type = "simple";
            Restart = "always";
          };
          script = ''
            echo ${pkgs.ffmpeg.bin}
              ${pkgs.pdm}/bin/pdm run -s -p ${worker} ${worker}/run.py --coordinator ${cfg.coordinator} --token ${cfg.token}
          '';
          environment = {
            LD_LIBRARY_PATH = "${pkgs.stdenv.cc.cc.lib}/lib:${worker}/__pypackages__/3.10/lib/numpy.libs/:${worker}/__pypackages__/3.10/lib/tokenizers.libs/";
            MODELS_DIR = cfg.modelsDir;
          };
          path = [ pkgs.ffmpeg.bin ];
          wantedBy = [ "multi-user.target" ];
        };
      }
      )

      (optionalAttrs (hasAttr "launchd" options) {
        launchd.daemons.transcribee-worker = {
          script = ''
            ${pkgs.pdm}/bin/pdm run -s -p ${worker} ${worker}/run.py --coordinator ${cfg.coordinator} --token ${cfg.token}
          '';
          environment = {
            LD_LIBRARY_PATH = "${pkgs.stdenv.cc.cc.lib}/lib:${worker}/__pypackages__/3.10/lib/numpy.libs/:${worker}/__pypackages__/3.10/lib/tokenizers.libs/";
            MODELS_DIR = cfg.modelsDir;
          };
          path = [
            pkgs.ffmpeg.bin
            pkgs.pkg-config
          ];
          serviceConfig = {
            KeepAlive = true;
            RunAtLoad = true;
            StandardOutPath = "/var/log/transcribee-worker.log";
            StandardErrorPath = "/var/log/transcribee-worker.log";
          };
        };
      })
    ]);
}
