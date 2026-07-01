package commands

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/serverme/serverme/cli/internal/client"
	"github.com/serverme/serverme/proto"
)

// ANSI color codes
const (
	reset   = "\033[0m"
	bold    = "\033[1m"
	dim     = "\033[2m"
	red     = "\033[31m"
	green   = "\033[32m"
	yellow  = "\033[33m"
	blue    = "\033[34m"
	magenta = "\033[35m"
	cyan    = "\033[36m"
	white   = "\033[37m"
)

func isColorEnabled() bool {
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	return true
}

func c(color, text string) string {
	if !isColorEnabled() {
		return text
	}
	return color + text + reset
}

func printBanner() {
	fmt.Println()
	fmt.Printf("  %s %s\n", c(bold+cyan, "Deployzy"), c(dim, "— Expose localhost to the world"))
	fmt.Printf("  %s\n", c(dim, strings.Repeat("─", 50)))
}

func printTunnelInfo(tunnels []client.ActiveTunnel, localAddr string, inspectorAddr string, inspect bool) {
	fmt.Println()
	fmt.Printf("  %s  %s\n", c(dim, "Version"), c(white, proto.Version))
	fmt.Printf("  %s       %s/%s\n", c(dim, "OS"), runtime.GOOS, runtime.GOARCH)

	if inspect && inspectorAddr != "" {
		fmt.Printf("  %s  %s\n", c(dim, "Inspect"), c(blue, "http://"+inspectorAddr))
	}

	fmt.Println()

	for _, t := range tunnels {
		arrow := c(dim, " → ")
		local := c(yellow, localAddr)

		switch {
		case strings.HasPrefix(t.URL, "https://"):
			fmt.Printf("  %s  %s%s%s\n", c(dim, "HTTP"), c(green+bold, t.URL), arrow, local)
		case strings.HasPrefix(t.URL, "tcp://"):
			fmt.Printf("  %s   %s%s%s\n", c(dim, "TCP"), c(magenta+bold, t.URL), arrow, local)
		case strings.HasPrefix(t.URL, "tls://"):
			fmt.Printf("  %s   %s%s%s\n", c(dim, "TLS"), c(blue+bold, t.URL), arrow, local)
		default:
			fmt.Printf("  %s %s%s%s\n", c(dim, "Tunnel"), c(green+bold, t.URL), arrow, local)
		}
	}

	fmt.Println()
	fmt.Printf("  %s\n", c(dim, "Press Ctrl+C to stop"))
	fmt.Printf("  %s\n", c(dim, strings.Repeat("─", 50)))
	fmt.Println()
}

func printConnecting(server string) {
	fmt.Printf("  %s Connecting to %s...\n", c(yellow, "●"), c(white, server))
}

func printConnected() {
	fmt.Printf("\r  %s Connected                    \n", c(green, "●"))
}

func printDisconnected(err error) {
	if err != nil {
		fmt.Printf("\n  %s Disconnected: %s\n", c(red, "●"), err)
	} else {
		fmt.Printf("\n  %s Disconnected\n", c(dim, "●"))
	}
}

func printReconnecting(attempt int, wait time.Duration) {
	fmt.Printf("  %s Reconnecting (attempt %d) in %s...\n", c(yellow, "●"), attempt, wait.Round(time.Second))
}

func printShutdown() {
	fmt.Printf("\n  %s Shutting down...\n", c(dim, "●"))
}
