// One-off: send the welcome email to the 21 July 2026 Google-OAuth signups,
// who never received one because the OAuth path didn't send it.
// Recipients are listed explicitly rather than queried, so a bad WHERE clause
// can't turn a 5-person backfill into a blast to the whole user table.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/notify"
)

var recipients = []struct{ Email, Name string }{
	{"genhuntbot@gmail.com", "Gen Hunt"},
	{"clawtunnel@gmail.com", "Jams Akino"},
	{"cmosesmaina@gmail.com", "Moses Maina"},
	{"johnsonaliyu47@gmail.com", "Aliu Johnson Temitope"},
	{"kiprutovictor@gmail.com", "Victor"},
}

func main() {
	key := flag.String("brevo-smtp-key", "", "Brevo SMTP key")
	dryRun := flag.Bool("dry-run", true, "print recipients without sending")
	flag.Parse()

	log := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).With().Timestamp().Logger()

	if *dryRun {
		fmt.Println("DRY RUN — would send Deployzy welcome email to:")
		for _, r := range recipients {
			fmt.Printf("  %-28s %s\n", r.Email, r.Name)
		}
		fmt.Printf("total: %d\n", len(recipients))
		return
	}
	if *key == "" {
		fmt.Fprintln(os.Stderr, "--brevo-smtp-key required to send")
		os.Exit(1)
	}

	svc := notify.NewEmailService("smtp-relay.brevo.com", "587",
		"9988d2001@smtp-brevo.com", *key, "noreply@deployzy.com", "Deployzy", log)

	var sent, failed int
	for _, r := range recipients {
		if err := svc.SendOne(r.Email, "Welcome to Deployzy 🚀", notify.WelcomeEmail(r.Name)); err != nil {
			fmt.Printf("  FAIL %-28s %v\n", r.Email, err)
			failed++
			continue
		}
		fmt.Printf("  sent %-28s %s\n", r.Email, r.Name)
		sent++
		time.Sleep(1500 * time.Millisecond) // be gentle with the relay
	}
	fmt.Printf("\nsent=%d failed=%d\n", sent, failed)
	if failed > 0 {
		os.Exit(1)
	}
}
