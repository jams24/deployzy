package deploy

// Docker's default json-file log driver keeps everything a container prints,
// forever. Long-running apps on the workers had grown single log files past
// 600 MB (and Asterisk's reached ~59 GB before it was capped). Every
// long-lived container we start gets a rotating cap instead: at most
// 3 x 20 MB per container. `docker logs` and the dashboard log views still
// show the most recent output.
//
// The cap is fixed when a container is created, so existing containers pick
// it up on their next deploy. It is set per container rather than in
// daemon.json, which would need a dockerd restart on live workers.

// DockerLogArgs is the cap as `docker run` arguments.
var DockerLogArgs = []string{"--log-opt", "max-size=20m", "--log-opt", "max-file=3"}

// DockerLogFlags is the same cap for `docker run` command strings run over SSH.
const DockerLogFlags = "--log-opt max-size=20m --log-opt max-file=3"
