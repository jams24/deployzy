package api

import (
	"testing"
	"time"

	"github.com/serverme/serverme/server/internal/billing"
)

func delivery(eventID, typ string, ok bool, code int, at time.Time) billing.PolarDelivery {
	d := billing.PolarDelivery{CreatedAt: at, Succeeded: ok, HTTPCode: &code}
	d.Event.ID, d.Event.Type = eventID, typ
	return d
}

func TestFailedPolarEvents(t *testing.T) {
	now := time.Now()
	// Newest first, as Polar returns them.
	ds := []billing.PolarDelivery{
		delivery("paid", "order.paid", true, 200, now),                  // redelivered OK → settled
		delivery("paid", "order.paid", false, 401, now.Add(-time.Hour)), // older failures ignored
		delivery("created", "order.created", false, 401, now.Add(-2*time.Hour)),
		delivery("created", "order.created", false, 401, now.Add(-3*time.Hour)),
		delivery("sub", "subscription.active", false, 500, now.Add(-4*time.Hour)),
	}
	got := failedPolarEvents(ds)
	if len(got) != 2 {
		t.Fatalf("want 2 failed events, got %d: %+v", len(got), got)
	}
	if got[0].EventID != "created" || got[0].Attempts != 2 || got[0].LastCode != 401 {
		t.Errorf("created: %+v", got[0])
	}
	if got[1].EventID != "sub" || got[1].Attempts != 1 || got[1].LastCode != 500 {
		t.Errorf("sub: %+v", got[1])
	}
	if len(failedPolarEvents(nil)) != 0 {
		t.Error("nil deliveries must give no failures")
	}
}

func TestExpectedPaymentID(t *testing.T) {
	o := billing.PolarOrder{ID: "ord", CheckoutID: "chk", BillingReason: "subscription_create"}
	if got := expectedPaymentID(o); got != "chk" {
		t.Errorf("create: %q", got)
	}
	o.BillingReason = "subscription_cycle"
	if got := expectedPaymentID(o); got != "polar_order_ord" {
		t.Errorf("cycle: %q", got)
	}
	o = billing.PolarOrder{ID: "ord", Metadata: map[string]string{"checkout_id": "meta"}}
	if got := expectedPaymentID(o); got != "meta" {
		t.Errorf("metadata fallback: %q", got)
	}
}

func TestUUIDOrEmpty(t *testing.T) {
	if uuidOrEmpty("bb1db71f-b607-447f-8366-a042af9477dd") == "" {
		t.Error("valid uuid dropped")
	}
	for _, bad := range []string{"", "cus_123", "bb1db71f-b607-447f-8366-a042af9477dd'; drop"} {
		if uuidOrEmpty(bad) != "" {
			t.Errorf("%q should be dropped", bad)
		}
	}
}
