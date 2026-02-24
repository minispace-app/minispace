use anyhow::Context;
use lettre::{
    message::{header::ContentType, Mailbox, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use uuid::Uuid;

use crate::config::Config;

pub struct EmailService {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

impl EmailService {
    /// Returns None if SMTP is not fully configured.
    pub fn new(config: &Config) -> Option<Self> {
        let host = config.smtp_host.as_deref()?;
        let username = config.smtp_username.clone()?;
        let password = config.smtp_password.clone()?;
        let from_addr = config.smtp_from.as_deref()?;

        let port = config.smtp_port.unwrap_or(587);
        let creds = Credentials::new(username, password);

        let transport = if port == 465 {
            AsyncSmtpTransport::<Tokio1Executor>::relay(host)
                .ok()?
                .credentials(creds)
                .build()
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)
                .ok()?
                .credentials(creds)
                .build()
        };

        let from: Mailbox = from_addr.parse().ok()?;

        Some(Self { transport, from })
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    fn new_message_id(&self) -> String {
        format!("<{}@{}>", Uuid::new_v4(), self.from.email.domain())
    }

    /// Wraps inner HTML content in a consistent branded email layout.
    /// Shows the tenant logo if logo_url is non-empty, otherwise shows the
    /// garderie name as text.
    fn wrap_html(logo_url: &str, garderie_name: &str, content: &str) -> String {
        let header = if !logo_url.is_empty() {
            format!(
                r#"<img src="{logo_url}" alt="{garderie_name}" style="max-height:64px;max-width:200px;width:auto;height:auto;display:block;margin:0 auto">"#
            )
        } else {
            format!(
                r#"<p style="margin:0;font-size:20px;font-weight:700;color:#0f172a;text-align:center">{garderie_name}</p>"#
            )
        };

        format!(
            r#"<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{garderie_name}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
          <tr>
            <td align="center" style="padding-bottom:28px">
              {header}
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 8px 24px rgba(0,0,0,0.04)">
              {content}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:20px">
              <p style="margin:0;font-size:12px;color:#94a3b8">{garderie_name}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"#
        )
    }

    async fn send_email(
        &self,
        from: Mailbox,
        to: Mailbox,
        subject: &str,
        text: &str,
        html: &str,
    ) -> anyhow::Result<()> {
        let email = Message::builder()
            .message_id(Some(self.new_message_id()))
            .from(from)
            .to(to)
            .subject(subject)
            .multipart(
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(text.to_string()),
                    )
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(html.to_string()),
                    ),
            )
            .context("Failed to build email message")?;

        self.transport
            .send(email)
            .await
            .context("Failed to send email")?;

        Ok(())
    }

    // ─── Public methods ───────────────────────────────────────────────────────

    pub async fn send_password_reset(
        &self,
        to_email: &str,
        to_name: &str,
        reset_url: &str,
        garderie_name: &str,
        logo_url: &str,
    ) -> anyhow::Result<()> {
        let from = Mailbox::new(Some(garderie_name.to_string()), self.from.email.clone());
        let to: Mailbox = format!("{to_name} <{to_email}>")
            .parse()
            .unwrap_or_else(|_| to_email.parse().expect("valid email address"));

        let subject = format!("Réinitialisation de mot de passe — {garderie_name}");

        let text = format!(
            "Bonjour {to_name},\n\n\
            Vous avez demandé une réinitialisation de mot de passe pour {garderie_name}.\n\n\
            Cliquez sur ce lien pour créer un nouveau mot de passe (valide 1 heure) :\n\
            {reset_url}\n\n\
            Si vous n'avez pas fait cette demande, ignorez cet email.\n\n\
            {garderie_name}"
        );

        let content = format!(
            r#"<h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#0f172a">Réinitialisation de mot de passe</h1>
<p style="margin:0 0 28px 0;font-size:15px;color:#64748b;line-height:1.6">Bonjour <strong style="color:#334155">{to_name}</strong>,<br><br>Vous avez demandé une réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en créer un nouveau.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
  <tr>
    <td style="border-radius:8px;background:#2563eb">
      <a href="{reset_url}" style="display:inline-block;padding:13px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px">Réinitialiser mon mot de passe</a>
    </td>
  </tr>
</table>
<p style="margin:0;font-size:13px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:20px;line-height:1.5">Ce lien expire dans <strong style="color:#64748b">1 heure</strong>. Si vous n'avez pas fait cette demande, ignorez cet email.</p>"#
        );

        let html = Self::wrap_html(logo_url, garderie_name, &content);
        self.send_email(from, to, &subject, &text, &html).await
    }

    pub async fn send_2fa_code(
        &self,
        to_email: &str,
        code: &str,
        garderie_name: &str,
        logo_url: &str,
    ) -> anyhow::Result<()> {
        let from = Mailbox::new(Some(garderie_name.to_string()), self.from.email.clone());
        let to: Mailbox = to_email.parse()?;

        let subject = format!("Code de connexion — {garderie_name}");

        let text = format!(
            "Votre code de connexion pour {garderie_name} est : {code}\n\n\
            Ce code est valide pendant 15 minutes.\n\n\
            Si vous n'avez pas tenté de vous connecter, ignorez cet email."
        );

        let content = format!(
            r#"<h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#0f172a">Code de connexion</h1>
<p style="margin:0 0 24px 0;font-size:15px;color:#64748b;line-height:1.6">Votre code de vérification à usage unique :</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
  <tr>
    <td align="center" style="background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;padding:24px 16px">
      <span style="font-size:44px;font-weight:800;letter-spacing:14px;color:#0f172a;font-variant-numeric:tabular-nums">{code}</span>
    </td>
  </tr>
</table>
<p style="margin:0;font-size:13px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:20px;line-height:1.5">Ce code expire dans <strong style="color:#64748b">15 minutes</strong>. Si vous n'avez pas tenté de vous connecter, ignorez cet email.</p>"#
        );

        let html = Self::wrap_html(logo_url, garderie_name, &content);
        self.send_email(from, to, &subject, &text, &html).await
    }

    pub async fn send_invitation(
        &self,
        to_email: &str,
        invite_url: &str,
        garderie_name: &str,
        role: &str,
        logo_url: &str,
    ) -> anyhow::Result<()> {
        let from = Mailbox::new(Some(garderie_name.to_string()), self.from.email.clone());
        let to: Mailbox = to_email.parse()?;

        let role_fr = match role {
            "admin_garderie" => "Administrateur",
            "educateur" => "Éducateur / Éducatrice",
            _ => "Parent",
        };

        let subject = format!("Invitation à rejoindre {garderie_name}");

        let text = format!(
            "Vous êtes invité(e) à rejoindre {garderie_name} en tant que {role_fr}.\n\n\
            Cliquez sur le lien pour créer votre compte :\n\
            {invite_url}\n\n\
            Ce lien expire dans 7 jours."
        );

        let content = format!(
            r#"<h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#0f172a">Vous êtes invité(e) !</h1>
<p style="margin:0 0 28px 0;font-size:15px;color:#64748b;line-height:1.6">Vous avez été invité(e) à rejoindre <strong style="color:#334155">{garderie_name}</strong> en tant que <strong style="color:#334155">{role_fr}</strong>.<br><br>Créez votre compte gratuitement en cliquant sur le bouton ci-dessous.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
  <tr>
    <td style="border-radius:8px;background:#2563eb">
      <a href="{invite_url}" style="display:inline-block;padding:13px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px">Créer mon compte</a>
    </td>
  </tr>
</table>
<p style="margin:0;font-size:13px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:20px;line-height:1.5">Ce lien expire dans <strong style="color:#64748b">7 jours</strong>.</p>"#
        );

        let html = Self::wrap_html(logo_url, garderie_name, &content);
        self.send_email(from, to, &subject, &text, &html).await
    }

    pub async fn send_message_notification(
        &self,
        to_email: &str,
        to_name: &str,
        sender_name: &str,
        thread_name: &str,
        app_url: &str,
        garderie_name: &str,
        logo_url: &str,
    ) -> anyhow::Result<()> {
        let from = Mailbox::new(Some(garderie_name.to_string()), self.from.email.clone());
        let to: Mailbox = format!("{to_name} <{to_email}>")
            .parse()
            .unwrap_or_else(|_| to_email.parse().expect("valid email address"));

        let subject = format!("Nouveau message — {thread_name}");

        let text = format!(
            "Bonjour {to_name},\n\n\
            Vous avez reçu un nouveau message de {sender_name} dans {thread_name}.\n\n\
            Connectez-vous pour voir le message :\n\
            {app_url}\n\n\
            {garderie_name}"
        );

        let content = format!(
            r#"<h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#0f172a">Nouveau message</h1>
<p style="margin:0 0 28px 0;font-size:15px;color:#64748b;line-height:1.6">Bonjour <strong style="color:#334155">{to_name}</strong>,<br><br><strong style="color:#334155">{sender_name}</strong> vous a envoyé un message dans <strong style="color:#334155">{thread_name}</strong>.</p>
<table role="presentation" cellpadding="0" cellspacing="0">
  <tr>
    <td style="border-radius:8px;background:#2563eb">
      <a href="{app_url}" style="display:inline-block;padding:13px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px">Voir le message</a>
    </td>
  </tr>
</table>"#
        );

        let html = Self::wrap_html(logo_url, garderie_name, &content);

        let email = Message::builder()
            .message_id(Some(self.new_message_id()))
            .from(from)
            .to(to)
            .subject(&subject)
            .multipart(
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(text),
                    )
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(html),
                    ),
            )
            .context("Failed to build email message")?;

        self.transport
            .send(email)
            .await
            .context("Failed to send email")?;

        Ok(())
    }

    pub async fn send_media_notification(
        &self,
        to_email: &str,
        to_name: &str,
        uploader_name: &str,
        content_kind: &str,
        app_url: &str,
        garderie_name: &str,
        logo_url: &str,
    ) -> anyhow::Result<()> {
        let from = Mailbox::new(Some(garderie_name.to_string()), self.from.email.clone());
        let to: Mailbox = format!("{to_name} <{to_email}>")
            .parse()
            .unwrap_or_else(|_| to_email.parse().expect("valid email address"));

        let subject = format!("Nouveau contenu partagé — {garderie_name}");

        let text = format!(
            "Bonjour {to_name},\n\n\
            {uploader_name} a partagé {content_kind} vous concernant sur {garderie_name}.\n\n\
            Connectez-vous pour voir le contenu :\n\
            {app_url}\n\n\
            {garderie_name}"
        );

        let content = format!(
            r#"<h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#0f172a">Nouveau contenu partagé</h1>
<p style="margin:0 0 28px 0;font-size:15px;color:#64748b;line-height:1.6">Bonjour <strong style="color:#334155">{to_name}</strong>,<br><br><strong style="color:#334155">{uploader_name}</strong> a partagé {content_kind} vous concernant.</p>
<table role="presentation" cellpadding="0" cellspacing="0">
  <tr>
    <td style="border-radius:8px;background:#2563eb">
      <a href="{app_url}" style="display:inline-block;padding:13px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px">Voir le contenu</a>
    </td>
  </tr>
</table>"#
        );

        let html = Self::wrap_html(logo_url, garderie_name, &content);
        self.send_email(from, to, &subject, &text, &html).await
    }

    pub async fn send_to_parents(
        &self,
        recipients: Vec<(String, String)>,
        subject: &str,
        body: &str,
        garderie_name: &str,
        logo_url: &str,
    ) -> anyhow::Result<()> {
        let from_with_name = Mailbox::new(Some(garderie_name.to_string()), self.from.email.clone());

        let content = format!(
            r#"<p style="margin:0;font-size:15px;color:#334155;line-height:1.7">{}</p>"#,
            body.replace('\n', "<br>")
        );
        let html = Self::wrap_html(logo_url, garderie_name, &content);

        for (email, name) in &recipients {
            let to: Mailbox = match format!("{name} <{email}>").parse() {
                Ok(m) => m,
                Err(_) => match email.parse() {
                    Ok(m) => m,
                    Err(_) => {
                        tracing::warn!("Skipping invalid email address: {email}");
                        continue;
                    }
                },
            };

            let email_msg = Message::builder()
                .message_id(Some(self.new_message_id()))
                .from(from_with_name.clone())
                .to(to)
                .subject(subject)
                .multipart(
                    MultiPart::alternative()
                        .singlepart(
                            SinglePart::builder()
                                .header(ContentType::TEXT_PLAIN)
                                .body(body.to_string()),
                        )
                        .singlepart(
                            SinglePart::builder()
                                .header(ContentType::TEXT_HTML)
                                .body(html.clone()),
                        ),
                )
                .context("Failed to build email message")?;

            if let Err(e) = self.transport.send(email_msg).await {
                tracing::warn!("Failed to send email to {email}: {e}");
            }
        }
        Ok(())
    }

    pub async fn send_contact_request(
        &self,
        name: &str,
        email: &str,
        garderie: &str,
        phone: &str,
    ) -> anyhow::Result<()> {
        let to = self.from.clone();
        let subject = format!("Nouvelle demande d'information — {garderie}");

        let text = format!(
            "Nouvelle demande d'information reçue via minispace.app\n\n\
            Nom : {name}\n\
            Email : {email}\n\
            Garderie : {garderie}\n\
            Téléphone : {phone}"
        );

        let content = format!(
            r#"<h1 style="margin:0 0 20px 0;font-size:20px;font-weight:700;color:#0f172a">Nouvelle demande d'information</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b;width:120px">Nom</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">{name}</td></tr>
  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">Email</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a"><a href="mailto:{email}" style="color:#2563eb">{email}</a></td></tr>
  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">Garderie</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">{garderie}</td></tr>
  <tr><td style="padding:10px 12px;font-size:14px;color:#64748b">Téléphone</td><td style="padding:10px 12px;font-size:14px;color:#0f172a">{phone}</td></tr>
</table>"#
        );

        let html = Self::wrap_html("", "minispace.app", &content);
        let from = Mailbox::new(Some("minispace.app".to_string()), self.from.email.clone());
        self.send_email(from, to, &subject, &text, &html).await
    }

    pub async fn send_journal(
        &self,
        to_email: &str,
        to_name: &str,
        html_body: &str,
        subject: &str,
    ) -> anyhow::Result<()> {
        let to: Mailbox = format!("{to_name} <{to_email}>")
            .parse()
            .unwrap_or_else(|_| to_email.parse().expect("valid email address"));

        let email = Message::builder()
            .message_id(Some(self.new_message_id()))
            .from(self.from.clone())
            .to(to)
            .subject(subject)
            .multipart(MultiPart::alternative().singlepart(SinglePart::html(html_body.to_string())))
            .context("Failed to build email message")?;

        self.transport
            .send(email)
            .await
            .context("Failed to send email")?;

        Ok(())
    }
}
