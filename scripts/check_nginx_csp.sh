#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config_file="${CSP_CONFIG_FILE:-$root_dir/nginx/conf.d/default.conf}"

csp="$(sed -n 's/^[[:space:]]*set \$CSP "\(.*\)";/\1/p' "$config_file")"
if [[ -z "$csp" ]]; then
  printf 'could not find the CSP definition in %s\n' "$config_file" >&2
  exit 1
fi

directive_sources() {
  local directive="$1"
  printf '%s\n' "$csp" |
    tr ';' '\n' |
    sed -n "s/^[[:space:]]*${directive}[[:space:]]\{1,\}//p"
}

require_source() {
  local directive="$1"
  local source="$2"
  local sources
  sources="$(directive_sources "$directive")"
  case " $sources " in
    *" $source "*) ;;
    *)
      printf 'CSP %s must include %s\n' "$directive" "$source" >&2
      exit 1
      ;;
  esac
}

# These are the narrow sources required by the Google Maps JavaScript API
# surfaces used by this project. googleusercontent.com is especially important
# for community-contributed Photo Spheres, whose missing tiles render as a
# status=OK black Street View canvas instead of a normal API error.
require_source script-src 'https://*.googleapis.com'
require_source script-src 'https://*.gstatic.com'
require_source script-src-elem 'https://*.googleapis.com'
require_source script-src-elem 'https://*.gstatic.com'
require_source img-src 'https://*.googleapis.com'
require_source img-src 'https://*.gstatic.com'
require_source img-src 'https://*.google.com'
require_source img-src 'https://*.googleusercontent.com'
require_source worker-src 'blob:'
require_source frame-src 'https://*.google.com'

printf 'nginx CSP check passed\n'
