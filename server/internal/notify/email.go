package notify

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

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

// TeamInviteEmail returns the HTML body for a team invitation email.
func TeamInviteEmail(inviterName, teamName, inviteURL string) string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>You've been invited to ` + teamName + `</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
  <tr>
    <td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <!-- Logo -->
        <tr>
          <td align="center" style="padding-bottom:32px;">
            <div style="display:inline-flex;align-items:center;gap:10px;">
              <div style="width:36px;height:36px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:8px;display:inline-block;"></div>
              <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Deployzy</span>
            </div>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#111111;border:1px solid #1f1f1f;border-radius:16px;padding:40px 40px 36px;overflow:hidden;">

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

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding:24px 0 0;">
            <p style="margin:0;font-size:12px;color:#333333;line-height:1.8;">
              <a href="https://deployzy.com" style="color:#6366f1;text-decoration:none;">deployzy.com</a>
              &nbsp;·&nbsp; Made with ♥ for developers
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

// WelcomeEmail returns the HTML body for a welcome email.
func WelcomeEmail(name string) string {
	displayName := name
	if displayName == "" {
		displayName = "there"
	}
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Welcome to Deployzy</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
  <tr>
    <td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <!-- Logo / Header -->
        <tr>
          <td align="center" style="padding-bottom:32px;">
            <div style="display:inline-flex;align-items:center;gap:10px;">
              <div style="width:36px;height:36px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:8px;display:inline-block;"></div>
              <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Deployzy</span>
            </div>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#111111;border:1px solid #1f1f1f;border-radius:16px;padding:40px 40px 32px;overflow:hidden;">

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

          </td>
        </tr>

        <!-- Feature pills -->
        <tr>
          <td style="padding:24px 0 0;">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center">
                  <span style="display:inline-block;background:#111111;border:1px solid #1f1f1f;border-radius:20px;padding:6px 14px;font-size:11px;color:#555555;margin:4px;">⚡ Auto-deploy on push</span>
                  <span style="display:inline-block;background:#111111;border:1px solid #1f1f1f;border-radius:20px;padding:6px 14px;font-size:11px;color:#555555;margin:4px;">🔒 Free SSL</span>
                  <span style="display:inline-block;background:#111111;border:1px solid #1f1f1f;border-radius:20px;padding:6px 14px;font-size:11px;color:#555555;margin:4px;">🗄️ Managed databases</span>
                  <span style="display:inline-block;background:#111111;border:1px solid #1f1f1f;border-radius:20px;padding:6px 14px;font-size:11px;color:#555555;margin:4px;">🌐 Secure tunnels</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding:28px 0 0;">
            <p style="margin:0;font-size:12px;color:#333333;line-height:1.8;">
              You're receiving this because you just signed up at <a href="https://deployzy.com" style="color:#6366f1;text-decoration:none;">deployzy.com</a><br/>
              <a href="https://deployzy.com" style="color:#333333;text-decoration:none;">Deployzy</a> · Made with ♥ for developers
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}
