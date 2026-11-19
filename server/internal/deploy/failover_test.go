package deploy

import (
	"context"
	"net"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/serverme/serverme/server/internal/db"
)

func TestServerReachable(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	ctx := context.Background()
	if !serverReachable(ctx, &db.WorkerServer{Host: "127.0.0.1", Port: port}) {
		t.Fatal("listening server reported unreachable")
	}
	ln.Close()

	// A server the heartbeat already flags offline gets one probe only.
	start := time.Now()
	if serverReachable(ctx, &db.WorkerServer{Host: "127.0.0.1", Port: port, Status: "offline"}) {
		t.Fatal("closed port reported reachable")
	}
	if time.Since(start) > time.Second {
		t.Errorf("offline server should get a single fast probe, took %s", time.Since(start))
	}

	// An "active" server is retried (3 attempts) before being declared down.
	defer func(b time.Duration) { probeBackoff = b }(probeBackoff)
	probeBackoff = 50 * time.Millisecond
	start = time.Now()
	if serverReachable(ctx, &db.WorkerServer{Host: "127.0.0.1", Port: port, Status: "active"}) {
		t.Fatal("closed port reported reachable")
	}
	if el := time.Since(start); el < 100*time.Millisecond {
		t.Errorf("active server should be retried, gave up after %s", el)
	}

	// A cancelled context gives up instead of retrying.
	cctx, cancel := context.WithCancel(ctx)
	cancel()
	if serverReachable(cctx, &db.WorkerServer{Host: "10.255.255.1", Port: 22}) {
		t.Fatal("cancelled ctx reported reachable")
	}
}

func TestIsLocalServer(t *testing.T) {
	for _, s := range []db.WorkerServer{{IsLocal: true, Host: "1.2.3.4"}, {Host: "localhost"}, {Host: "127.0.0.1"}, {Host: ""}} {
		if !isLocalServer(&s) {
			t.Errorf("%+v should be local", s)
		}
	}
	if isLocalServer(&db.WorkerServer{Host: "163.245.221.94"}) {
		t.Error("remote host treated as local")
	}
}

func TestEnvKeysPointingAt(t *testing.T) {
	dead := &db.WorkerServer{Host: "163.245.221.94", ServiceHost: "database-miso.deployzy.com"}
	env := map[string]string{
		"DATABASE_URL": "postgres://u:p@database-miso.deployzy.com:20001/app",
		"REDIS_URL":    "redis://163.245.221.94:6379",
		"API_URL":      "https://api.example.com",
		"PORT":         "3000",
	}
	got := envKeysPointingAt(env, dead)
	if want := []string{"DATABASE_URL", "REDIS_URL"}; !reflect.DeepEqual(got, want) {
		t.Errorf("got %v want %v", got, want)
	}
	// Local hosts never match ("localhost" appears in plenty of env values).
	local := &db.WorkerServer{Host: "localhost", ServiceHost: "127.0.0.1"}
	if got := envKeysPointingAt(map[string]string{"X": "http://localhost:" + strconv.Itoa(80)}, local); len(got) != 0 {
		t.Errorf("local server matched %v", got)
	}
}
