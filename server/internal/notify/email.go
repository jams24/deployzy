package notify

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"strconv"
	"time"

	"github.com/rs/zerolog"
)

// Mailer is the minimal interface the deploy engine needs to send alert emails.
type Mailer interface {
	SendOne(to, subject, htmlBody string) error
}

type EmailService struct {
	host      string
	port      string
	login     string
	password  string
	fromEmail string
	fromName  string
	log       zerolog.Logger
}

func NewEmailService(host, port, login, password, fromEmail, fromName string, log zerolog.Logger) *EmailService {
	return &EmailService{
		host:      host,
		port:      port,
		login:     login,
		password:  password,
		fromEmail: fromEmail,
		fromName:  fromName,
		log:       log.With().Str("component", "email").Logger(),
	}
}

// Send delivers an HTML email to one or more recipients.
func (e *EmailService) Send(to []string, subject, htmlBody string) error {
	auth := smtp.PlainAuth("", e.login, e.password, e.host)

	msg := e.buildMessage(to, subject, htmlBody)

	addr := net.JoinHostPort(e.host, e.port)
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return fmt.Errorf("dial smtp: %w", err)
	}

	c, err := smtp.NewClient(conn, e.host)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer c.Quit()

	// STARTTLS on port 587
	if ok, _ := c.Extension("STARTTLS"); ok {
		cfg := &tls.Config{ServerName: e.host}
		if err := c.StartTLS(cfg); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
	}

	if err := c.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}

	from := fmt.Sprintf("%s <%s>", e.fromName, e.fromEmail)
	if err := c.Mail(e.fromEmail); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	_ = from

	for _, addr := range to {
		if err := c.Rcpt(addr); err != nil {
			e.log.Warn().Err(err).Str("to", addr).Msg("rcpt failed, skipping")
		}
	}

	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	_, err = w.Write([]byte(msg))
	if err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	return w.Close()
}

func (e *EmailService) buildMessage(to []string, subject, htmlBody string) string {
	from := fmt.Sprintf("%s <%s>", e.fromName, e.fromEmail)
	headers := []string{
		"MIME-Version: 1.0",
		"Content-Type: text/html; charset=UTF-8",
		fmt.Sprintf("From: %s", from),
		fmt.Sprintf("To: %s", strings.Join(to, ", ")),
		fmt.Sprintf("Subject: %s", subject),
		fmt.Sprintf("Date: %s", time.Now().UTC().Format(time.RFC1123Z)),
	}
	return strings.Join(headers, "\r\n") + "\r\n\r\n" + htmlBody
}

// SendOne is a convenience wrapper for a single recipient.
func (e *EmailService) SendOne(to, subject, htmlBody string) error {
	return e.Send([]string{to}, subject, htmlBody)
}

// brandShell wraps content in the standard Deployzy email shell:
// logo header → card content → footer. Pass the inner card HTML only.
func brandShell(cardHTML, footerNote string) string {
	if footerNote == "" {
		footerNote = "You're receiving this because you have a Deployzy account."
	}
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
  <tr>
    <td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <!-- Logo -->
        <tr>
          <td align="center" style="padding-bottom:32px;">
            <a href="https://deployzy.com" style="text-decoration:none;display:inline-block;">
              <img src="https://deployzy.com/logo-dark.svg" width="140" height="28" alt="Deployzy" style="display:block;border:0;"/>
            </a>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#111111;border:1px solid #1f1f1f;border-radius:16px;overflow:hidden;">
            <div style="padding:40px 40px 36px;">
              ` + cardHTML + `
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:28px 0 0;">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center" style="padding-bottom:16px;">
                  <div style="height:1px;background:#1a1a1a;"></div>
                </td>
              </tr>
              <tr>
                <td align="center">
                  <p style="margin:0 0 6px;font-size:12px;color:#444444;line-height:1.7;">` + footerNote + `</p>
                  <p style="margin:0;font-size:12px;color:#333333;line-height:1.8;">
                    <a href="https://deployzy.com" style="color:#6366f1;text-decoration:none;font-weight:500;">deployzy.com</a>
                    &nbsp;·&nbsp;
                    <a href="https://deployzy.com/docs" style="color:#444444;text-decoration:none;">Docs</a>
                    &nbsp;·&nbsp;
                    <a href="https://deployzy.com/dashboard" style="color:#444444;text-decoration:none;">Dashboard</a>
                    &nbsp;·&nbsp;
                    <a href="mailto:support@deployzy.com" style="color:#444444;text-decoration:none;">Support</a>
                    &nbsp;·&nbsp;
                    <span style="color:#333333;">Made with ♥ for developers</span>
                  </p>
                  <p style="margin:10px 0 0;font-size:11px;color:#2e2e2e;line-height:1.7;">
                    © ` + strconv.Itoa(time.Now().Year()) + ` Deployzy™. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

// BroadcastEmail wraps a raw HTML body in the Deployzy brand shell.
// Used by the admin broadcast so every campaign email has a consistent header/footer.
func BroadcastEmail(subject, bodyHTML string) string {
	return brandShell(bodyHTML, "You're receiving this because you have a Deployzy account. &nbsp;<a href=\"https://deployzy.com/dashboard/settings\" style=\"color:#444444;\">Unsubscribe</a>")
}

// DeployFailedEmail returns the HTML body for a deploy-failure notification.
func DeployFailedEmail(projectName, projectURL, logsURL, crashLogs string) string {
	truncated := crashLogs
	if len(truncated) > 1800 {
		truncated = "…" + truncated[len(truncated)-1800:]
	}

	card := `
    <!-- Status badge -->
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="background:#1a0a0a;border:1px solid #3d1212;border-radius:20px;padding:5px 12px;">
          <span style="font-size:11px;font-weight:600;color:#ef4444;letter-spacing:0.5px;text-transform:uppercase;">⬤ &nbsp;Deploy Failed</span>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">
      <strong style="color:#f87171;">` + projectName + `</strong> failed to deploy
    </p>
    <p style="margin:0 0 28px;font-size:14px;color:#888888;line-height:1.6;">
      Your new container was unhealthy and never went live. The previous version is still serving traffic.
    </p>

    <div style="height:1px;background:#1f1f1f;margin-bottom:24px;"></div>

    <!-- Crash log -->
    <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.8px;">Last 20 lines of container output</p>
    <div style="background:#0d0d0d;border:1px solid #2a1010;border-left:3px solid #ef4444;border-radius:8px;padding:16px 18px;margin-bottom:28px;overflow:hidden;">
      <pre style="margin:0;font-family:'SF Mono',Consolas,'Courier New',monospace;font-size:12px;color:#cc8888;line-height:1.7;white-space:pre-wrap;word-break:break-all;">` + htmlEscape(truncated) + `</pre>
    </div>

    <!-- Actions -->
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding-right:10px;" width="50%">
          <a href="` + logsURL + `"
             style="display:block;text-align:center;background:transparent;border:1px solid #2a2a2a;color:#cccccc;font-size:13px;font-weight:500;text-decoration:none;padding:11px 20px;border-radius:8px;">
            View Full Logs
          </a>
        </td>
        <td width="50%">
          <a href="` + projectURL + `"
             style="display:block;text-align:center;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:8px;">
            Open Project →
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:20px 0 0;font-size:12px;color:#444444;line-height:1.7;text-align:center;">
      Common causes: missing env variables, wrong start command, out-of-memory, or a port mismatch.<br/>
      Check your <strong style="color:#666666;">Start Command</strong> and <strong style="color:#666666;">Environment Variables</strong> in project settings.
    </p>`

	return brandShell(card, "You're receiving this because you have a Deployzy project. &nbsp;<a href=\"https://deployzy.com/dashboard/settings\" style=\"color:#444444;\">Manage notifications</a>")
}

// htmlEscape escapes < > & for safe embedding in HTML.
func htmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}

// TeamInviteEmail returns the HTML body for a team invitation email.
func TeamInviteEmail(inviterName, teamName, inviteURL string) string {
	card := `

            <!-- Icon -->
            <div style="width:52px;height:52px;background:#1a1a2e;border:1px solid #6366f1;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:24px;">
              <span style="font-size:22px;">👥</span>
            </div>

            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">
              You've been invited
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#888888;line-height:1.6;">
              <strong style="color:#cccccc;">` + inviterName + `</strong> has invited you to join the
              <strong style="color:#cccccc;">` + teamName + `</strong> workspace on Deployzy.
            </p>

            <div style="height:1px;background:#1f1f1f;margin-bottom:28px;"></div>

            <p style="margin:0 0 16px;font-size:13px;color:#666666;line-height:1.6;">
              As a team member you'll be able to collaborate on projects, databases, tunnels, and deployments — all in one place.
            </p>

            <!-- What you get -->
            <table cellpadding="0" cellspacing="0" width="100%" style="background:#0d0d0d;border:1px solid #1f1f1f;border-radius:10px;padding:0;margin-bottom:32px;">
              <tr><td style="padding:14px 20px;border-bottom:1px solid #1f1f1f;">
                <span style="font-size:13px;color:#aaaaaa;">✦ &nbsp;Access shared projects &amp; deployments</span>
              </td></tr>
              <tr><td style="padding:14px 20px;border-bottom:1px solid #1f1f1f;">
                <span style="font-size:13px;color:#aaaaaa;">✦ &nbsp;Shared databases &amp; tunnels</span>
              </td></tr>
              <tr><td style="padding:14px 20px;">
                <span style="font-size:13px;color:#aaaaaa;">✦ &nbsp;Collaborative deploy logs &amp; metrics</span>
              </td></tr>
            </table>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center">
                  <a href="` + inviteURL + `"
                     style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:13px 36px;border-radius:8px;letter-spacing:0.2px;">
                    Accept Invitation →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:20px 0 0;font-size:12px;color:#444444;text-align:center;line-height:1.7;">
              This invitation expires in <strong style="color:#666666;">7 days</strong>.<br/>
              If you weren't expecting this, you can safely ignore it.
            </p>
`
	return brandShell(card, "You're receiving this because someone invited you to a team on Deployzy.")
}

// WelcomeEmail returns the HTML body for a welcome email.
func WelcomeEmail(name string) string {
	displayName := name
	if displayName == "" {
		displayName = "there"
	}
	card := `

            <!-- Greeting -->
            <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">
              Welcome, ` + displayName + `! 🚀
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#888888;line-height:1.6;">
              Your account is ready. Let's deploy your first project in under a minute.
            </p>

            <!-- Divider -->
            <div style="height:1px;background:#1f1f1f;margin-bottom:28px;"></div>

            <!-- Steps -->
            <p style="margin:0 0 16px;font-size:12px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:0.8px;">Get started in 3 steps</p>

            <!-- Step 1 -->
            <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
              <tr>
                <td width="36" valign="top">
                  <div style="width:28px;height:28px;background:#1a1a2e;border:1px solid #6366f1;border-radius:50%;text-align:center;line-height:28px;font-size:12px;font-weight:700;color:#6366f1;">1</div>
                </td>
                <td valign="top" style="padding-left:12px;">
                  <p style="margin:0;font-size:14px;font-weight:600;color:#ffffff;">Connect your GitHub repo</p>
                  <p style="margin:4px 0 0;font-size:13px;color:#666666;line-height:1.5;">Import any project from GitHub with one click. We detect the framework automatically.</p>
                </td>
              </tr>
            </table>

            <!-- Step 2 -->
            <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
              <tr>
                <td width="36" valign="top">
                  <div style="width:28px;height:28px;background:#1a1a2e;border:1px solid #6366f1;border-radius:50%;text-align:center;line-height:28px;font-size:12px;font-weight:700;color:#6366f1;">2</div>
                </td>
                <td valign="top" style="padding-left:12px;">
                  <p style="margin:0;font-size:14px;font-weight:600;color:#ffffff;">Deploy in seconds</p>
                  <p style="margin:4px 0 0;font-size:13px;color:#666666;line-height:1.5;">Push to your branch and we build, containerise, and serve your app with a live subdomain instantly.</p>
                </td>
              </tr>
            </table>

            <!-- Step 3 -->
            <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;">
              <tr>
                <td width="36" valign="top">
                  <div style="width:28px;height:28px;background:#1a1a2e;border:1px solid #6366f1;border-radius:50%;text-align:center;line-height:28px;font-size:12px;font-weight:700;color:#6366f1;">3</div>
                </td>
                <td valign="top" style="padding-left:12px;">
                  <p style="margin:0;font-size:14px;font-weight:600;color:#ffffff;">Scale with databases &amp; tunnels</p>
                  <p style="margin:4px 0 0;font-size:13px;color:#666666;line-height:1.5;">Add Postgres, Redis, or MongoDB. Expose any local port securely with our tunnel service.</p>
                </td>
              </tr>
            </table>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center">
                  <a href="https://deployzy.com/new"
                     style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;letter-spacing:0.2px;">
                    Deploy your first project →
                  </a>
                </td>
              </tr>
            </table>
`
	return brandShell(card, "You're receiving this because you just created a Deployzy account.")
}

// VerifyCodeEmail renders the 6-digit signup confirmation code. Uses the brand
// shell so it matches every other transactional email.
func VerifyCodeEmail(name, code string) string {
	displayName := name
	if displayName == "" {
		displayName = "there"
	}
	card := `
            <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">
              Confirm your email
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#888888;line-height:1.6;">
              Hi ` + displayName + `, enter this code to finish creating your Deployzy account.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:12px;padding:24px 16px;">
                  <p style="margin:0;font-size:34px;font-weight:700;letter-spacing:10px;color:#34D399;font-family:'SFMono-Regular',Consolas,monospace;">
                    ` + code + `
                  </p>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;font-size:13px;color:#666666;line-height:1.6;">
              This code expires in 15 minutes. If you didn't sign up for Deployzy,
              you can safely ignore this email — no account will be created.
            </p>`
	return brandShell(card, "You're receiving this because someone signed up for Deployzy with this address.")
}

// SubscriptionEmail renders the billing confirmation for a new purchase,
// upgrade, downgrade, or renewal. kind is "new" | "upgrade" | "downgrade" |
// "renewal"; anything else is treated as a new subscription.
func SubscriptionEmail(name, plan, kind string, amount float64, currency, renewsOn string) string {
	displayName := name
	if displayName == "" {
		displayName = "there"
	}
	planTitle := strings.ToUpper(plan[:1]) + plan[1:]

	headline, blurb := "You're on "+planTitle+" 🎉", "Your subscription is active. Thanks for backing Deployzy!"
	switch kind {
	case "upgrade":
		headline = "Upgraded to " + planTitle + " 🚀"
		blurb = "Your new limits are live right now — no redeploy needed."
	case "downgrade":
		headline = "Switched to " + planTitle
		blurb = "Your plan has been changed. The new limits apply immediately."
	case "renewal":
		headline = planTitle + " renewed ✅"
		blurb = "Thanks for sticking with Deployzy — your subscription rolls on for another month."
	}

	card := `
            <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">
              ` + headline + `
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#888888;line-height:1.6;">
              Hi ` + displayName + `, ` + blurb + `
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:12px;">
              <tr>
                <td style="padding:16px 20px;border-bottom:1px solid #1f1f1f;">
                  <span style="font-size:13px;color:#666666;">Plan</span>
                  <span style="float:right;font-size:13px;color:#ffffff;font-weight:600;">` + planTitle + `</span>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 20px;border-bottom:1px solid #1f1f1f;">
                  <span style="font-size:13px;color:#666666;">Amount</span>
                  <span style="float:right;font-size:13px;color:#ffffff;font-weight:600;">` + fmt.Sprintf("%.2f %s", amount, currency) + `</span>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 20px;">
                  <span style="font-size:13px;color:#666666;">Renews on</span>
                  <span style="float:right;font-size:13px;color:#ffffff;font-weight:600;">` + renewsOn + `</span>
                </td>
              </tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
              <tr>
                <td align="center">
                  <a href="https://deployzy.com/billing"
                     style="display:inline-block;background:#ffffff;color:#0a0a0a;text-decoration:none;
                            font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">
                    View billing
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;font-size:12px;color:#666666;line-height:1.6;">
              Questions about your subscription? Just reply to this email or reach us at
              <a href="mailto:support@deployzy.com" style="color:#888888;">support@deployzy.com</a>.
            </p>`
	return brandShell(card, "You're receiving this because you have a Deployzy subscription.")
}
