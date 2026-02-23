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

    pub async fn send_password_reset(
        &self,
        to_email: &str,
        to_name: &str,
        reset_url: &str,
        garderie_name: &str,
    ) -> anyhow::Result<()> {
        let from = Mailbox::new(Some(garderie_name.to_string()), self.from.email.clone());
        let to: Mailbox = format!("{to_name} <{to_email}>")
            .parse()
            .unwrap_or_else(|_| to_email.parse().expect("valid email address"));

        let subject = format!("Réinitialisation de mot de passe — {garderie_name}");

        let text = format!(
            "Bonjour {to_name},\n\n\
            Vous avez demandé une réinitialisation de mot de passe pour {garderie_name}.\n\n\
            Cliquez sur le lien ci-dessous pour créer un nouveau mot de passe (valide 1 heure) :\n\
            {reset_url}\n\n\
            Si vous n'avez pas fait cette demande, ignorez cet email.\n\n\
            Cordialement,\n\
            {garderie_name}"
        );

        let html = format!(
            r#"<html><body style="font-family:sans-serif;max-width:600px;margin:auto">
            <p>Bonjour {to_name},</p>
            <p>Vous avez demandé une réinitialisation de mot de passe pour <strong>{garderie_name}</strong>.</p>
            <p style="margin:24px 0">
              <a href="{reset_url}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">
                Réinitialiser mon mot de passe
              </a>
            </p>
            <p style="color:#64748b;font-size:13px">Ce lien expire dans 1 heure. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
            </body></html>"#
        );

        self.send_email(from, to, &subject, &text, &html).await
    }

    pub async fn send_2fa_code(
        &self,
        to_email: &str,
        code: &str,
        garderie_name: &str,
    ) -> anyhow::Result<()> {
        let from = Mailbox::new(Some(garderie_name.to_string()), self.from.email.clone());
        let to: Mailbox = to_email.parse()?;

        let subject = format!("Code de connexion — {garderie_name}");

        let text = format!(
            "Votre code de connexion pour {garderie_name} est : {code}\n\n\
            Ce code est valide pendant 15 minutes.\n\n\
            Si vous n'avez pas tenté de vous connecter, ignorez cet email."
        );

        let html = format!(
            r#"<html><body style="font-family:sans-serif;max-width:600px;margin:auto">
            <p>Votre code de connexion pour <strong>{garderie_name}</strong> :</p>
            <p style="font-size:36px;font-weight:bold;letter-spacing:8px;margin:24px 0;color:#1e293b">{code}</p>
            <p style="color:#64748b;font-size:13px">Ce code expire dans 15 minutes. Si vous n'avez pas tenté de vous connecter, ignorez cet email.</p>
            </body></html>"#
        );

        self.send_email(from, to, &subject, &text, &html).await
    }

    pub async fn send_invitation(
        &self,
        to_email: &str,
        invite_url: &str,
        garderie_name: &str,
        role: &str,
    ) -> anyhow::Result<()> {
        let from = Mailbox::new(Some(garderie_name.to_string()), self.from.email.clone());
        let to: Mailbox = to_email.parse()?;

        let role_fr = match role {
            "admin_garderie" => "Administrateur",
            "educateur" => "Éducateur/Éducatrice",
            _ => "Parent",
        };

        let subject = format!("Invitation à rejoindre {garderie_name}");

        let text = format!(
            "Vous êtes invité(e) à rejoindre {garderie_name} en tant que {role_fr}.\n\n\
            Cliquez sur le lien pour créer votre compte :\n\
            {invite_url}\n\n\
            Ce lien expire dans 7 jours."
        );

        let html = format!(
            r#"<html><body style="font-family:sans-serif;max-width:600px;margin:auto">
            <p>Vous êtes invité(e) à rejoindre <strong>{garderie_name}</strong> en tant que <strong>{role_fr}</strong>.</p>
            <p style="margin:24px 0">
              <a href="{invite_url}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">
                Créer mon compte
              </a>
            </p>
            <p style="color:#64748b;font-size:13px">Ce lien expire dans 7 jours.</p>
            </body></html>"#
        );

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
    ) -> anyhow::Result<()> {
        let to: Mailbox = format!("{to_name} <{to_email}>")
            .parse()
            .unwrap_or_else(|_| to_email.parse().expect("valid email address"));

        // Le champ From affiche le nom de la garderie plutôt que l'adresse brute
        let from = Mailbox::new(Some(garderie_name.to_string()), self.from.email.clone());

        let subject = format!("Nouveau message — {thread_name}");

        let text = format!(
            "Bonjour {to_name},\n\n\
            Vous avez reçu un nouveau message de {sender_name} dans {thread_name}.\n\n\
            Connectez-vous pour voir le message :\n\
            {app_url}\n\n\
            Cordialement,\n\
            {garderie_name}"
        );

        let html = format!(
            r#"<html><body style="font-family:sans-serif;max-width:600px;margin:auto">
            <p>Bonjour {to_name},</p>
            <p>Vous avez reçu un nouveau message de <strong>{sender_name}</strong> dans <strong>{thread_name}</strong>.</p>
            <p style="margin:24px 0">
              <a href="{app_url}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">
                Voir le message
              </a>
            </p>
            <p style="color:#64748b;font-size:12px">{garderie_name}</p>
            </body></html>"#
        );

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
        content_kind: &str, // ex: "de nouvelles photos", "une vidéo", "un nouveau document"
        app_url: &str,
        garderie_name: &str,
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
            Cordialement,\n\
            {garderie_name}"
        );

        let html = format!(
            r#"<html><body style="font-family:sans-serif;max-width:600px;margin:auto">
            <p>Bonjour {to_name},</p>
            <p><strong>{uploader_name}</strong> a partagé {content_kind} vous concernant sur <strong>{garderie_name}</strong>.</p>
            <p style="margin:24px 0">
              <a href="{app_url}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">
                Voir le contenu
              </a>
            </p>
            <p style="color:#64748b;font-size:12px">{garderie_name}</p>
            </body></html>"#
        );

        self.send_email(from, to, &subject, &text, &html).await
    }

    pub async fn send_to_parents(
        &self,
        recipients: Vec<(String, String)>,
        subject: &str,
        body: &str,
        garderie_name: &str,
    ) -> anyhow::Result<()> {
        let from_with_name = Mailbox::new(Some(garderie_name.to_string()), self.from.email.clone());

        let html = format!(
            r#"<html><body style="font-family:sans-serif;max-width:600px;margin:auto">{}</body></html>"#,
            body.replace('\n', "<br>")
        );

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

    fn new_message_id(&self) -> String {
        format!("<{}@{}>", Uuid::new_v4(), self.from.email.domain())
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

    pub async fn send_contact_request(
        &self,
        name: &str,
        email: &str,
        garderie: &str,
        phone: &str,
    ) -> anyhow::Result<()> {
        let to = self.from.clone(); // send to the configured SMTP address (admin inbox)

        let subject = format!("Nouvelle demande d'information — {garderie}");

        let text = format!(
            "Nouvelle demande d'information reçue via minispace.app\n\n\
            Nom : {name}\n\
            Email : {email}\n\
            Garderie : {garderie}\n\
            Téléphone : {phone}"
        );

        let html = format!(
            r#"<html><body style="font-family:sans-serif;max-width:600px;margin:auto">
            <h2 style="color:#2563eb">Nouvelle demande d'information</h2>
            <table style="border-collapse:collapse;width:100%;margin-top:16px">
              <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc;width:140px">Nom</td><td style="padding:10px;border:1px solid #e2e8f0">{name}</td></tr>
              <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc">Email</td><td style="padding:10px;border:1px solid #e2e8f0"><a href="mailto:{email}">{email}</a></td></tr>
              <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc">Garderie</td><td style="padding:10px;border:1px solid #e2e8f0">{garderie}</td></tr>
              <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc">Téléphone</td><td style="padding:10px;border:1px solid #e2e8f0">{phone}</td></tr>
            </table>
            <p style="margin-top:24px;color:#64748b;font-size:13px">Envoyé depuis minispace.app</p>
            </body></html>"#
        );

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
