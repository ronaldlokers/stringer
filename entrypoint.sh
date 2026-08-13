#!/bin/sh
# Trust the cluster's own CA, without anyone having to remember to.
#
# The Kubernetes API serves a certificate signed by the cluster CA, which is
# projected into every pod. Node's fetch does not look there, and the failure
# is a bare "TypeError: fetch failed" with nothing about certificates in it —
# which is exactly how it presented the first time.
#
# NODE_EXTRA_CA_CERTS is read once at startup, so it has to be set before node
# runs rather than by the program itself. Setting it here means the image is
# correct in a cluster by default and needs no environment variable in any
# manifest; an operator who sets one anyway wins.
if [ -z "$NODE_EXTRA_CA_CERTS" ] && [ -r /var/run/secrets/kubernetes.io/serviceaccount/ca.crt ]; then
  export NODE_EXTRA_CA_CERTS=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
fi
exec node /app/dist/src/index.js "$@"
