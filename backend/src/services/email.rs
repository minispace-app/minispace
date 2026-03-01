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

    /// Notifie contact@minispace.app qu'une nouvelle garderie vient d'être créée via inscription libre.
    pub async fn send_new_signup_notification(
        &self,
        slug: &str,
        name: &str,
        email: &str,
        first_name: &str,
        last_name: &str,
        phone: &str,
        address: &str,
        trial_expires_at: &str,
    ) -> anyhow::Result<()> {
        let to = self.from.clone();
        let subject = format!("🎉 Nouvelle garderie — {name} ({slug})");

        let text = format!(
            "Nouvelle garderie créée via inscription libre\n\n\
            Identifiant : {slug}\n\
            Nom : {name}\n\
            Téléphone : {phone}\n\
            Adresse : {address}\n\
            Admin : {first_name} {last_name}\n\
            Courriel : {email}\n\
            URL : https://{slug}.minispace.app\n\
            Essai expire : {trial_expires_at}"
        );

        let phone_row = if !phone.is_empty() {
            format!(r#"  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">Téléphone</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a">{phone}</td></tr>"#)
        } else { String::new() };
        let address_row = if !address.is_empty() {
            format!(r#"  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">Adresse</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a">{address}</td></tr>"#)
        } else { String::new() };

        let content = format!(
            r#"<h1 style="margin:0 0 20px 0;font-size:20px;font-weight:700;color:#0f172a">🎉 Nouvelle garderie créée</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b;width:130px">Identifiant</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:700;font-family:monospace">{slug}</td></tr>
  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">Nom</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">{name}</td></tr>
  {phone_row}
  {address_row}
  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">Admin</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a">{first_name} {last_name}</td></tr>
  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">Courriel</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a"><a href="mailto:{email}" style="color:#2563eb">{email}</a></td></tr>
  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">URL</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a"><a href="https://{slug}.minispace.app/fr/login" style="color:#2563eb">{slug}.minispace.app</a></td></tr>
  <tr><td style="padding:10px 12px;font-size:14px;color:#64748b">Essai expire</td><td style="padding:10px 12px;font-size:14px;color:#0f172a">{trial_expires_at}</td></tr>
</table>"#
        );

        let html = Self::wrap_html("", "minispace.app", &content);
        let from = Mailbox::new(Some("minispace.app".to_string()), self.from.email.clone());
        self.send_email(from, to, &subject, &text, &html).await
    }

    /// Email de bienvenue envoyé à l'admin de la nouvelle garderie.
    pub async fn send_welcome_email(
        &self,
        to_email: &str,
        to_name: &str,
        garderie_name: &str,
        slug: &str,
        login_url: &str,
        trial_expires_at: &str,
    ) -> anyhow::Result<()> {
        let to: Mailbox = format!("{to_name} <{to_email}>")
            .parse()
            .unwrap_or_else(|_| to_email.parse().expect("valid email"));

        let subject = format!("Bienvenue sur minispace.app — {garderie_name} est prête !");

        let text = format!(
            "Bonjour {to_name},\n\n\
            Merci d'avoir créé votre espace sur minispace.app — bienvenue dans la communauté !\n\n\
            Votre garderie « {garderie_name} » est maintenant accessible à l'adresse suivante :\n\
            {login_url}\n\n\
            Votre période d'essai gratuit est active jusqu'au {trial_expires_at}.\n\
            Vous avez accès à toutes les fonctionnalités sans restriction.\n\n\
            — Comment démarrer ?\n\
            1. Connectez-vous à votre tableau de bord\n\
            2. Invitez vos éducateurs via le menu Utilisateurs\n\
            3. Ajoutez vos enfants et groupes\n\
            4. Les parents recevront une invitation par courriel\n\n\
            — Des questions ?\n\
            Écrivez-nous en tout temps à contact@minispace.app — nous répondons rapidement.\n\n\
            — Continuer après l'essai ?\n\
            Si minispace.app vous convient, contactez-nous avant l'expiration de votre essai \
            pour passer à un abonnement. Aucune interruption de service, vos données sont conservées.\n\n\
            Bonne exploration !\n\
            L'équipe minispace.app"
        );

        let content = format!(
            r#"<h1 style="margin:0 0 8px 0;font-size:22px;font-weight:800;color:#0f172a">Bienvenue sur minispace.app !</h1>
<p style="margin:0 0 24px 0;font-size:15px;color:#64748b">Votre garderie est prête.</p>

<p style="margin:0 0 16px 0;font-size:15px;color:#374151">Bonjour <strong>{to_name}</strong>,</p>
<p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6">
  Merci d'avoir créé votre espace sur <strong>minispace.app</strong> — bienvenue dans la communauté !
  Votre garderie <strong>« {garderie_name} »</strong> est maintenant active et prête à accueillir
  votre équipe et les familles.
</p>

<div style="text-align:center;margin:28px 0">
  <a href="{login_url}"
     style="display:inline-block;padding:13px 32px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-weight:700;font-size:15px;border-radius:12px;text-decoration:none;letter-spacing:0.01em">
    Accéder à mon tableau de bord
  </a>
</div>

<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;margin-bottom:24px">
  <p style="margin:0 0 4px 0;font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.06em">Essai gratuit</p>
  <p style="margin:0;font-size:15px;color:#0f172a">Actif jusqu'au <strong>{trial_expires_at}</strong> — accès complet à toutes les fonctionnalités, sans restriction.</p>
</div>

<h2 style="margin:0 0 12px 0;font-size:16px;font-weight:700;color:#0f172a">Comment démarrer ?</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
  <tr>
    <td style="padding:8px 12px 8px 0;vertical-align:top;font-size:14px;color:#6366f1;font-weight:700;white-space:nowrap">1.</td>
    <td style="padding:8px 0;font-size:14px;color:#374151">Connectez-vous et explorez le tableau de bord</td>
  </tr>
  <tr>
    <td style="padding:8px 12px 8px 0;vertical-align:top;font-size:14px;color:#6366f1;font-weight:700">2.</td>
    <td style="padding:8px 0;font-size:14px;color:#374151">Invitez vos éducateurs via le menu <strong>Utilisateurs</strong></td>
  </tr>
  <tr>
    <td style="padding:8px 12px 8px 0;vertical-align:top;font-size:14px;color:#6366f1;font-weight:700">3.</td>
    <td style="padding:8px 0;font-size:14px;color:#374151">Ajoutez vos enfants et groupes</td>
  </tr>
  <tr>
    <td style="padding:8px 12px 8px 0;vertical-align:top;font-size:14px;color:#6366f1;font-weight:700">4.</td>
    <td style="padding:8px 0;font-size:14px;color:#374151">Les parents recevront leur invitation par courriel</td>
  </tr>
</table>

<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:20px 24px;margin-bottom:24px">
  <h3 style="margin:0 0 8px 0;font-size:15px;font-weight:700;color:#92400e">Des questions ou besoin d'aide ?</h3>
  <p style="margin:0;font-size:14px;color:#78350f;line-height:1.6">
    Écrivez-nous en tout temps à
    <a href="mailto:contact@minispace.app" style="color:#d97706;font-weight:600">contact@minispace.app</a>.
    Nous répondons rapidement et avec plaisir.
  </p>
</div>

<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px 24px">
  <h3 style="margin:0 0 8px 0;font-size:15px;font-weight:700;color:#14532d">Continuer après l'essai ?</h3>
  <p style="margin:0;font-size:14px;color:#166534;line-height:1.6">
    Si minispace.app vous convient, contactez-nous avant l'expiration de votre essai pour passer
    à un abonnement. Aucune interruption de service — toutes vos données sont conservées.
  </p>
</div>"#
        );

        let html = Self::wrap_html("", garderie_name, &content);
        let from = Mailbox::new(Some("minispace.app".to_string()), self.from.email.clone());
        self.send_email(from, to, &subject, &text, &html).await
    }

    /// Envoie un rappel d'expiration d'essai à contact@minispace.app et à l'admin de la garderie.
    pub async fn send_trial_expiry_warning(
        &self,
        admin_email: &str,
        admin_name: &str,
        slug: &str,
        garderie_name: &str,
        days_left: i64,
        login_url: &str,
    ) -> anyhow::Result<()> {
        let (urgency_color, days_label) = if days_left <= 1 {
            ("#dc2626", "demain".to_string())
        } else {
            ("#d97706", format!("dans {days_left} jours"))
        };

        // 1. Email à l'admin de la garderie
        let to_admin: Mailbox = format!("{admin_name} <{admin_email}>")
            .parse()
            .unwrap_or_else(|_| admin_email.parse().expect("valid email"));

        let subject_admin = if days_left <= 1 {
            format!("⚠️ Dernier jour — Votre essai minispace.app expire demain")
        } else {
            format!("Rappel — Votre essai minispace.app expire dans {days_left} jours")
        };

        let text_admin = format!(
            "Bonjour {admin_name},\n\n\
            Votre période d'essai gratuit pour {garderie_name} expire {days_label}.\n\n\
            Pour continuer à utiliser minispace.app, contactez-nous à contact@minispace.app.\n\n\
            Accéder au tableau de bord : {login_url}"
        );

        let content_admin = format!(
            r#"<h1 style="margin:0 0 16px 0;font-size:20px;font-weight:700;color:#0f172a">Votre essai expire {days_label}</h1>
<p style="margin:0 0 20px 0;font-size:15px;color:#374151">Bonjour <strong>{admin_name}</strong>,</p>
<p style="margin:0 0 20px 0;font-size:15px;color:#374151">
  Votre période d'essai gratuit pour <strong>{garderie_name}</strong> expire <strong style="color:{urgency_color}">{days_label}</strong>.
</p>
<p style="margin:0 0 24px 0;font-size:15px;color:#374151">
  Pour continuer à utiliser minispace.app, contactez-nous à
  <a href="mailto:contact@minispace.app" style="color:#2563eb">contact@minispace.app</a>.
</p>
<div style="text-align:center;margin-bottom:8px">
  <a href="{login_url}" style="display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;font-weight:600;font-size:15px;border-radius:10px;text-decoration:none">
    Accéder au tableau de bord
  </a>
</div>"#
        );

        let html_admin = Self::wrap_html("", garderie_name, &content_admin);
        let from = Mailbox::new(Some("minispace.app".to_string()), self.from.email.clone());
        self.send_email(from.clone(), to_admin, &subject_admin, &text_admin, &html_admin).await?;

        // 2. Copie interne à contact@minispace.app
        let to_internal = self.from.clone();
        let subject_internal = format!(
            "⏳ Essai {garderie_name} ({slug}) expire {days_label}"
        );
        let text_internal = format!(
            "Rappel d'expiration d'essai\n\n\
            Garderie : {garderie_name} ({slug})\n\
            Admin : {admin_name} <{admin_email}>\n\
            Expire : {days_label}\n\
            URL : https://{slug}.minispace.app"
        );
        let content_internal = format!(
            r#"<h1 style="margin:0 0 20px 0;font-size:20px;font-weight:700;color:#0f172a">⏳ Essai sur le point d'expirer</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b;width:130px">Garderie</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;font-weight:600">{garderie_name} <span style="font-family:monospace;font-weight:400;color:#64748b">({slug})</span></td></tr>
  <tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#64748b">Admin</td><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a">{admin_name} — <a href="mailto:{admin_email}" style="color:#2563eb">{admin_email}</a></td></tr>
  <tr><td style="padding:10px 12px;font-size:14px;color:#64748b">Expire</td><td style="padding:10px 12px;font-size:14px;font-weight:700;color:{urgency_color}">{days_label}</td></tr>
</table>"#
        );
        let html_internal = Self::wrap_html("", "minispace.app", &content_internal);
        self.send_email(from, to_internal, &subject_internal, &text_internal, &html_internal).await
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

    pub async fn send_account_deletion_request(
        &self,
        admin_email: &str,
        first_name: &str,
        last_name: &str,
        user_email: &str,
        user_id: &str,
        timestamp: &str,
        _tenant: &str,
    ) -> anyhow::Result<()> {
        let to = admin_email.parse::<Mailbox>()
            .context("Invalid admin email")?;

        let subject = format!(
            "[minispace.app] Demande de suppression de compte — {} {}",
            first_name, last_name
        );

        let html_body = format!(
            r#"<h1 style="margin:0 0 20px 0;font-size:20px;font-weight:700;color:#0f172a">Demande de suppression de compte</h1>
<p style="margin:0 0 20px 0;color:#475569;line-height:1.6">Un utilisateur a demandé la suppression de son compte et de ses données personnelles conformément à la Loi 25 (droit à l'oubli).</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;margin:20px 0">
  <tr>
    <td style="padding:20px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="width:160px;color:#64748b;font-size:14px;padding:8px 0;font-weight:600">Nom complet :</td>
          <td style="color:#0f172a;font-size:14px;padding:8px 0;font-weight:500">{} {}</td>
        </tr>
        <tr>
          <td style="width:160px;color:#64748b;font-size:14px;padding:8px 0;font-weight:600">Courriel :</td>
          <td style="color:#0f172a;font-size:14px;padding:8px 0;font-weight:500"><a href="mailto:{}" style="color:#0284c7;text-decoration:none">{}</a></td>
        </tr>
        <tr>
          <td style="width:160px;color:#64748b;font-size:14px;padding:8px 0;font-weight:600">ID utilisateur :</td>
          <td style="color:#0f172a;font-size:14px;padding:8px 0;font-family:monospace;background:#e2e8f0;padding:4px 8px;border-radius:4px;display:inline-block">{}</td>
        </tr>
        <tr>
          <td style="width:160px;color:#64748b;font-size:14px;padding:8px 0;font-weight:600">Date/Heure :</td>
          <td style="color:#0f172a;font-size:14px;padding:8px 0">{}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;border-radius:4px;margin:20px 0">
  <p style="margin:0;color:#7f1d1d;font-size:14px;font-weight:500">⚠️ Action requise</p>
  <p style="margin:8px 0 0 0;color:#991b1b;font-size:14px;line-height:1.5">Cette demande doit être traitée conformément à la Loi 25 du Québec (droit à l'oubli). Veuillez :</p>
  <ol style="margin:8px 0 0 16px;color:#991b1b;font-size:14px;line-height:1.6">
    <li>Vérifier l'identité de l'utilisateur</li>
    <li>Supprimer le compte et toutes les données personnelles associées</li>
    <li>Conserver une trace de cette action à des fins de conformité</li>
  </ol>
</div>

<p style="margin:20px 0 0 0;color:#64748b;font-size:12px;line-height:1.6">
  <strong>Note :</strong> Ce courriel a été envoyé automatiquement par minispace.app suite à une demande de suppression de compte.<br>
  Pour toute question concernant la conformité LOI 25, veuillez consulter la documentation de minispace.app.
</p>"#,
            first_name, last_name, user_email, user_email, user_id, timestamp
        );

        let text = format!(
            "Demande de suppression de compte\n\n\
             Nom: {} {}\n\
             Courriel: {}\n\
             ID utilisateur: {}\n\
             Demandé le: {}\n\n\
             Veuillez traiter cette demande conformément à la Loi 25 (droit à l'oubli).",
            first_name, last_name, user_email, user_id, timestamp
        );

        let email = Message::builder()
            .message_id(Some(self.new_message_id()))
            .from(self.from.clone())
            .to(to)
            .subject(subject)
            .multipart(MultiPart::alternative()
                .singlepart(SinglePart::plain(text))
                .singlepart(SinglePart::html(html_body)))
            .context("Failed to build email message")?;

        self.transport
            .send(email)
            .await
            .context("Failed to send email")?;

        Ok(())
    }
}
