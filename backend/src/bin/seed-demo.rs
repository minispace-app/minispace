//! Demo tenant seed script
//!
//! Seeds the `demo` tenant with realistic French-language data:
//! - Garderie: Garderie Les Petits Explorateurs (Démo)
//! - 4 users: 1 admin, 1 educateur, 2 parents
//! - 3 groups: Poupons, Bambins, Explorateurs
//! - 10 children distributed across groups with parent links
//! - 10+ messages (1 broadcast, 2 group, 8 individual)
//! - Journal entries for the last 5 business days for each child
//! - 6 demo photos (JPEG generated programmatically)
//! - 2 demo documents (PDF generated programmatically)
//!
//! Usage:
//!   DATABASE_URL=... DEMO_PASSWORD=Demo2024! MEDIA_DIR=/data/media ./seed-demo
//!
//! Environment variables:
//!   DATABASE_URL   — PostgreSQL connection string (required)
//!   DEMO_PASSWORD  — Password for all demo accounts (default: Demo2024!)
//!   MEDIA_DIR      — Base directory for media files (default: /data/media)

use anyhow::{Context, Result};
use chrono::{Datelike, Duration, NaiveDate, Utc, Weekday};
use image::{DynamicImage, ImageFormat, RgbImage};
use sqlx::postgres::PgPoolOptions;
use std::env;
use uuid::Uuid;

use minispace_api::db::tenant::{provision_tenant_schema, schema_name};

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    let database_url = env::var("DATABASE_URL").context("DATABASE_URL required")?;
    let demo_password = env::var("DEMO_PASSWORD").unwrap_or_else(|_| "Demo2024!".to_string());
    let media_dir = env::var("MEDIA_DIR").unwrap_or_else(|_| "/data/media".to_string());

    println!("=== Seed Demo Tenant ===");

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .context("Failed to connect to database")?;

    let schema = schema_name("demo"); // "garderie_demo"

    // 1. Clean existing demo tenant
    println!("Cleaning existing demo tenant...");

    // Remove uploaded media files for the demo tenant
    let demo_media_dir = std::path::Path::new(&media_dir).join("demo");
    if demo_media_dir.exists() {
        std::fs::remove_dir_all(&demo_media_dir)
            .with_context(|| format!("Failed to remove demo media dir: {:?}", demo_media_dir))?;
        println!("  Removed media files: {:?}", demo_media_dir);
    }

    sqlx::raw_sql(&format!("DROP SCHEMA IF EXISTS \"{schema}\" CASCADE"))
        .execute(&pool)
        .await
        .context("Failed to drop demo schema")?;

    sqlx::query("DELETE FROM public.garderies WHERE slug = 'demo'")
        .execute(&pool)
        .await
        .context("Failed to delete demo garderie")?;

    // 2. Create garderie record
    println!("Creating garderie record...");
    sqlx::query(
        "INSERT INTO public.garderies (slug, name, is_active)
         VALUES ('demo', 'Garderie Les Petits Explorateurs (Démo)', TRUE)",
    )
    .execute(&pool)
    .await
    .context("Failed to insert garderie")?;

    // 3. Provision tenant schema (creates all tables, enums, triggers)
    println!("Provisioning tenant schema...");
    provision_tenant_schema(&pool, "demo")
        .await
        .context("Failed to provision tenant schema")?;

    // 4. Hash password (cost 10 for seed speed)
    let password_hash =
        bcrypt::hash(&demo_password, 10).context("Failed to hash demo password")?;

    // 5. Insert users
    println!("Inserting users...");
    let admin_id = Uuid::new_v4();
    let educateur_id = Uuid::new_v4();
    let parent1_id = Uuid::new_v4();
    let parent2_id = Uuid::new_v4();

    let users = [
        (admin_id,     "admin@demo.minispace.app",    "Marie",         "Tremblay", "admin_garderie"),
        (educateur_id, "sophie@demo.minispace.app",   "Sophie",        "Gagnon",   "educateur"),
        (parent1_id,   "jean@demo.minispace.app",     "Jean-François", "Leblanc",  "parent"),
        (parent2_id,   "isabelle@demo.minispace.app", "Isabelle",      "Roy",      "parent"),
    ];

    for (id, email, first, last, role) in &users {
        sqlx::query(&format!(
            r#"INSERT INTO "{schema}".users
               (id, email, password_hash, first_name, last_name, role, preferred_locale)
               VALUES ($1, $2, $3, $4, $5, $6::"{schema}".user_role, 'fr')"#
        ))
        .bind(id)
        .bind(email)
        .bind(&password_hash)
        .bind(first)
        .bind(last)
        .bind(role)
        .execute(&pool)
        .await
        .with_context(|| format!("Failed to insert user {email}"))?;
    }

    // 6. Insert groups
    println!("Inserting groups...");
    let group_poupons_id = Uuid::new_v4();
    let group_bambins_id = Uuid::new_v4();
    let group_explorateurs_id = Uuid::new_v4();

    let groups = [
        (group_poupons_id,      "Poupons",      "0-18 mois",       "#3B82F6"),
        (group_bambins_id,      "Bambins",      "18 mois - 3 ans", "#22C55E"),
        (group_explorateurs_id, "Explorateurs", "3-5 ans",         "#F97316"),
    ];

    for (id, name, description, color) in &groups {
        sqlx::query(&format!(
            r#"INSERT INTO "{schema}".groups (id, name, description, color)
               VALUES ($1, $2, $3, $4)"#
        ))
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(color)
        .execute(&pool)
        .await
        .with_context(|| format!("Failed to insert group {name}"))?;
    }

    // 7. Insert children
    println!("Inserting children...");
    let today = Utc::now().date_naive();

    // (id, first_name, last_name, birth_date, group_id)
    let children: Vec<(Uuid, &str, &str, NaiveDate, Uuid)> = vec![
        // Poupons (0-18 mois) — 3 enfants
        (Uuid::new_v4(), "Léa",      "Tremblay",  today - Duration::days(180), group_poupons_id),
        (Uuid::new_v4(), "Emma",     "Gagnon",    today - Duration::days(250), group_poupons_id),
        (Uuid::new_v4(), "Lucas",    "Leblanc",   today - Duration::days(320), group_poupons_id),
        // Bambins (18 mois - 3 ans) — 4 enfants
        (Uuid::new_v4(), "Noah",     "Roy",       today - Duration::days(600), group_bambins_id),
        (Uuid::new_v4(), "Olivia",   "Tremblay",  today - Duration::days(700), group_bambins_id),
        (Uuid::new_v4(), "Théo",     "Gagnon",    today - Duration::days(800), group_bambins_id),
        (Uuid::new_v4(), "Juliette", "Martin",    today - Duration::days(900), group_bambins_id),
        // Explorateurs (3-5 ans) — 3 enfants
        (Uuid::new_v4(), "Liam",     "Bouchard",  today - Duration::days(1200), group_explorateurs_id),
        (Uuid::new_v4(), "Chloé",    "Leblanc",   today - Duration::days(1400), group_explorateurs_id),
        (Uuid::new_v4(), "Nathan",   "Roy",       today - Duration::days(1600), group_explorateurs_id),
    ];

    let child_ids: Vec<Uuid> = children.iter().map(|(id, _, _, _, _)| *id).collect();

    for (id, first_name, last_name, birth_date, group_id) in &children {
        sqlx::query(&format!(
            r#"INSERT INTO "{schema}".children (id, first_name, last_name, birth_date, group_id)
               VALUES ($1, $2, $3, $4, $5)"#
        ))
        .bind(id)
        .bind(first_name)
        .bind(last_name)
        .bind(birth_date)
        .bind(group_id)
        .execute(&pool)
        .await
        .with_context(|| format!("Failed to insert child {first_name}"))?;
    }

    // 8. Link children to parents
    println!("Linking children to parents...");
    // Jean-François Leblanc: Léa [0], Noah [3], Chloé [8]
    // Isabelle Roy: Emma [1], Olivia [4]
    let parent_links = [
        (child_ids[0], parent1_id), // Léa → Jean-François
        (child_ids[3], parent1_id), // Noah → Jean-François
        (child_ids[8], parent1_id), // Chloé → Jean-François
        (child_ids[1], parent2_id), // Emma → Isabelle
        (child_ids[4], parent2_id), // Olivia → Isabelle
    ];

    for (child_id, user_id) in &parent_links {
        sqlx::query(&format!(
            r#"INSERT INTO "{schema}".child_parents (child_id, user_id, relationship)
               VALUES ($1, $2, 'parent')"#
        ))
        .bind(child_id)
        .bind(user_id)
        .execute(&pool)
        .await
        .context("Failed to insert child_parent link")?;
    }

    // 9. Insert messages (10+)
    println!("Inserting messages...");
    let now = Utc::now();

    // (sender_id, message_type, group_id, recipient_id, content, subject, hours_ago)
    type MsgTuple<'a> = (Uuid, &'a str, Option<Uuid>, Option<Uuid>, &'a str, Option<&'a str>, i64);
    let messages: Vec<MsgTuple<'_>> = vec![
        // 1 broadcast
        (
            educateur_id, "broadcast", None, None,
            "Bonjour à toutes les familles ! Rappel : la garderie sera fermée le vendredi 28 février pour la journée pédagogique. Bonne semaine à tous !",
            Some("Rappel : Journée pédagogique vendredi"),
            48,
        ),
        // 2 messages de groupe
        (
            educateur_id, "group", Some(group_bambins_id), None,
            "Bonjour aux parents des Bambins ! Nous avons commencé un nouveau projet sur les couleurs cette semaine. Les enfants adorent mélanger les peintures !",
            None,
            24,
        ),
        (
            educateur_id, "group", Some(group_explorateurs_id), None,
            "Rappel aux parents des Explorateurs : la sortie au parc est prévue pour demain matin. Prévoyez des vêtements chauds et une collation.",
            None,
            12,
        ),
        // Conversations individuelles — Jean-François ↔ Sophie
        (
            educateur_id, "individual", None, Some(parent1_id),
            "Bonjour Jean-François ! Juste pour vous informer que Noah a très bien dormi aujourd'hui, 1h30 de sieste. Il était de bonne humeur tout l'après-midi.",
            None,
            72,
        ),
        (
            parent1_id, "individual", None, Some(educateur_id),
            "Merci Sophie ! C'est une bonne nouvelle. Il était un peu grognon ce matin, je suis soulagé qu'il ait bien récupéré.",
            None,
            70,
        ),
        (
            educateur_id, "individual", None, Some(parent1_id),
            "Grande nouvelle : Léa a fait ses premiers pas seule aujourd'hui ! Nous étions tous tellement fiers d'elle !",
            None,
            50,
        ),
        (
            parent1_id, "individual", None, Some(educateur_id),
            "Oh wow, c'est incroyable ! Merci de nous avoir prévenus si vite. On va fêter ça ce soir !",
            None,
            48,
        ),
        // Conversations individuelles — Isabelle ↔ Sophie
        (
            educateur_id, "individual", None, Some(parent2_id),
            "Bonsoir Isabelle, Emma a refusé de manger à dîner aujourd'hui. Elle a grignoté un peu, mais rien d'inquiétant. Je voulais juste vous prévenir.",
            None,
            36,
        ),
        (
            parent2_id, "individual", None, Some(educateur_id),
            "Merci Sophie ! Elle avait pris un gros déjeuner ce matin, c'est probablement pour ça. Je vais surveiller ce soir.",
            None,
            34,
        ),
        (
            educateur_id, "individual", None, Some(parent2_id),
            "Olivia a adoré l'activité peinture ce matin ! Elle a réalisé un magnifique tableau coloré pour vous. Il sera dans son sac ce soir.",
            None,
            6,
        ),
        (
            parent2_id, "individual", None, Some(educateur_id),
            "Je viens de la voir et c'est absolument adorable ! Merci infiniment Sophie, vous faites un travail fantastique avec les enfants.",
            None,
            2,
        ),
    ];

    for (sender_id, msg_type, group_id, recipient_id, content, subject, hours_ago) in &messages {
        let created_at = now - Duration::hours(*hours_ago);
        sqlx::query(&format!(
            r#"INSERT INTO "{schema}".messages
               (id, sender_id, message_type, group_id, recipient_id, content, subject, created_at, updated_at)
               VALUES (public.uuid_generate_v4(), $1, $2::"{schema}".message_type, $3, $4, $5, $6, $7, $7)"#
        ))
        .bind(sender_id)
        .bind(msg_type)
        .bind(group_id)
        .bind(recipient_id)
        .bind(content)
        .bind(subject)
        .bind(created_at)
        .execute(&pool)
        .await
        .context("Failed to insert message")?;
    }

    // 10. Insert journal entries for last 5 business days
    println!("Inserting journal entries...");
    let business_days = last_n_business_days(today, 5);

    let appetits = ["comme_habitude", "peu", "beaucoup", "comme_habitude", "beaucoup"];
    let humeurs  = ["tres_bien", "bien", "tres_bien", "difficile", "bien"];
    let weather  = ["ensoleille", "nuageux", "ensoleille", "pluie", "ensoleille"];
    let menus = [
        "Soupe à la courge, poulet grillé, compote de pommes",
        "Macaroni au fromage, salade de concombre, yogourt",
        "Lasagne végétarienne, pain de blé, orange",
        "Ragoût de légumes, riz basmati, banane",
        "Spaghetti bolognaise, brocoli vapeur, pouding au riz",
    ];
    let first_names = ["Léa", "Emma", "Lucas", "Noah", "Olivia", "Théo", "Juliette", "Liam", "Chloé", "Nathan"];

    for (day_idx, date) in business_days.iter().enumerate() {
        for (child_idx, child_id) in child_ids.iter().enumerate() {
            let appetit     = appetits[(day_idx + child_idx) % 5];
            let humeur      = humeurs[(day_idx + child_idx) % 5];
            let weather_val = weather[day_idx % 5];
            let menu        = menus[day_idx % 5];
            let sommeil: i16 = 60 + ((child_idx as i16 + day_idx as i16) % 3) * 30;
            let first_name  = first_names[child_idx];

            let obs_note = match humeur {
                "tres_bien"  => format!("{first_name} était en grande forme aujourd'hui, très souriant(e)."),
                "bien"       => format!("{first_name} a passé une belle journée, de bonne humeur."),
                "difficile"  => format!("{first_name} a eu un moment difficile en matinée, mais s'est bien repris(e) l'après-midi."),
                _            => format!("{first_name} a passé une belle journée."),
            };

            sqlx::query(&format!(
                r#"INSERT INTO "{schema}".daily_journals
                   (child_id, date, temperature, menu, appetit, humeur,
                    sommeil_minutes, message_educatrice, created_by)
                   VALUES ($1, $2,
                           $3::"{schema}".weather_condition,
                           $4,
                           $5::"{schema}".appetit_level,
                           $6::"{schema}".humeur_level,
                           $7, $8, $9)
                   ON CONFLICT (child_id, date) DO NOTHING"#
            ))
            .bind(child_id)
            .bind(date)
            .bind(weather_val)
            .bind(menu)
            .bind(appetit)
            .bind(humeur)
            .bind(sommeil)
            .bind(&obs_note)
            .bind(educateur_id)
            .execute(&pool)
            .await
            .with_context(|| format!("Failed to insert journal for {first_name} on {date}"))?;
        }
    }

    // 11. Seed demo media files and documents
    println!("Inserting demo media files and documents...");
    seed_media_and_docs(
        &pool,
        &schema,
        &media_dir,
        educateur_id,
        admin_id,
        group_poupons_id,
        group_bambins_id,
        group_explorateurs_id,
        child_ids[0], // Léa
        child_ids[1], // Emma
    )
    .await
    .context("Failed to seed media/documents")?;

    println!();
    println!("=== Demo tenant seeded successfully! ===");
    println!("  Garderie : Garderie Les Petits Explorateurs (Démo)");
    println!("  Schema   : {schema}");
    println!("  Users    :");
    for (_, email, first, last, role) in &users {
        println!("             {email} ({first} {last}, {role})");
    }
    println!("  Password : {demo_password}");
    println!("  Groups   : Poupons (3), Bambins (4), Explorateurs (3)");
    println!("  Children : {} total", child_ids.len());
    println!("  Messages : {} total", messages.len());
    println!(
        "  Journal  : {} entries ({} children × {} days)",
        child_ids.len() * business_days.len(),
        child_ids.len(),
        business_days.len()
    );

    Ok(())
}

// ─── Media & Documents ────────────────────────────────────────────────────────

async fn seed_media_and_docs(
    pool: &sqlx::PgPool,
    schema: &str,
    media_dir: &str,
    uploader_id: Uuid,
    _admin_id: Uuid,
    group_poupons_id: Uuid,
    group_bambins_id: Uuid,
    group_explorateurs_id: Uuid,
    child_lea_id: Uuid,
    child_emma_id: Uuid,
) -> Result<()> {
    let now = Utc::now();
    let year  = now.format("%Y").to_string();
    let month = now.format("%m").to_string();

    let base_dir = std::path::PathBuf::from(media_dir)
        .join("demo")
        .join(&year)
        .join(&month);
    tokio::fs::create_dir_all(&base_dir).await?;

    // ── Photos ──────────────────────────────────────────────────────────────
    struct Photo {
        caption:    &'static str,
        bg:         [u8; 3],
        accent:     [u8; 3],
        visibility: &'static str,
        group_id:   Option<Uuid>,
        child_id:   Option<Uuid>,
    }

    let photos = [
        Photo {
            caption:    "Activité peinture — groupe Poupons",
            bg:         [180, 210, 240], accent: [80, 140, 210],
            visibility: "group", group_id: Some(group_poupons_id), child_id: None,
        },
        Photo {
            caption:    "Jeux en groupe — les Bambins",
            bg:         [170, 225, 175], accent: [60, 160, 90],
            visibility: "group", group_id: Some(group_bambins_id), child_id: None,
        },
        Photo {
            caption:    "Sortie au parc — Explorateurs",
            bg:         [245, 205, 160], accent: [220, 130, 60],
            visibility: "group", group_id: Some(group_explorateurs_id), child_id: None,
        },
        Photo {
            caption:    "Léa fait ses premiers pas !",
            bg:         [230, 200, 225], accent: [170, 110, 160],
            visibility: "child", group_id: None, child_id: Some(child_lea_id),
        },
        Photo {
            caption:    "Emma découvre la peinture",
            bg:         [240, 225, 185], accent: [205, 165, 85],
            visibility: "child", group_id: None, child_id: Some(child_emma_id),
        },
        Photo {
            caption:    "Bonne humeur ce matin !",
            bg:         [200, 225, 240], accent: [110, 165, 205],
            visibility: "public", group_id: None, child_id: None,
        },
    ];

    for photo in &photos {
        let id = Uuid::new_v4();
        let filename       = format!("{id}.jpg");
        let thumb_filename = format!("{id}_thumb.jpg");

        let img_data   = generate_photo(800, 600, photo.bg, photo.accent);
        let thumb_data = make_thumbnail(&img_data);
        let size_bytes = img_data.len() as i64;

        tokio::fs::write(base_dir.join(&filename),       &img_data).await?;
        tokio::fs::write(base_dir.join(&thumb_filename), &thumb_data).await?;

        let storage_path   = format!("demo/{year}/{month}/{filename}");
        let thumbnail_path = format!("demo/{year}/{month}/{thumb_filename}");

        sqlx::query(&format!(
            r#"INSERT INTO "{schema}".media
               (id, uploader_id, media_type, original_filename, storage_path,
                thumbnail_path, content_type, size_bytes, width, height,
                group_id, child_id, caption, visibility, is_encrypted)
               VALUES ($1, $2, 'photo'::"{schema}".media_type, $3, $4, $5,
                       'image/jpeg', $6, 800, 600,
                       $7, $8, $9, $10::"{schema}".media_visibility, false)"#
        ))
        .bind(id)
        .bind(uploader_id)
        .bind(&filename)
        .bind(&storage_path)
        .bind(&thumbnail_path)
        .bind(size_bytes)
        .bind(photo.group_id)
        .bind(photo.child_id)
        .bind(photo.caption)
        .bind(photo.visibility)
        .execute(pool)
        .await
        .with_context(|| format!("Failed to insert media record for '{}'", photo.caption))?;

        // Also insert into media_children junction for child-specific photos
        if let Some(cid) = photo.child_id {
            sqlx::query(&format!(
                r#"INSERT INTO "{schema}".media_children (media_id, child_id) VALUES ($1, $2)"#
            ))
            .bind(id)
            .bind(cid)
            .execute(pool)
            .await?;
        }
    }

    println!("  {} photos générées", photos.len());

    // ── Documents ────────────────────────────────────────────────────────────
    let docs_dir = std::path::PathBuf::from(media_dir)
        .join("demo")
        .join(&year)
        .join(&month)
        .join("docs");
    tokio::fs::create_dir_all(&docs_dir).await?;

    struct Doc {
        title:    &'static str,
        category: &'static str,
        lines:    &'static [&'static str],
    }

    let docs = [
        Doc {
            title:    "Menu de la semaine",
            category: "menu",
            lines: &[
                "Garderie Les Petits Explorateurs",
                "",
                "Lundi    : Soupe courge, poulet grille, compote",
                "Mardi    : Macaroni fromage, salade concombre, yogourt",
                "Mercredi : Lasagne vegetarienne, pain, orange",
                "Jeudi    : Ragout legumes, riz basmati, banane",
                "Vendredi : Spaghetti bolognaise, brocoli, pouding riz",
                "",
                "Collations : fruits frais, fromage, craquelins",
                "Allergenes : voir politique affichee a l'entree",
            ],
        },
        Doc {
            title:    "Politique sur les allergies alimentaires",
            category: "politique",
            lines: &[
                "Garderie Les Petits Explorateurs",
                "Politique sur les allergies alimentaires",
                "",
                "Notre garderie est un milieu sans arachides et sans noix.",
                "",
                "Tout aliment apporte de la maison doit etre",
                "declare et approuve par la direction.",
                "",
                "En cas de reaction allergique, nous disposons",
                "d'un epi-pen et le 911 sera contacte immediatement.",
                "",
                "Les parents doivent informer la direction de toute",
                "allergie connue ou suspectee.",
            ],
        },
        Doc {
            title:    "Calendrier des activités — Mars",
            category: "bulletin",
            lines: &[
                "Garderie Les Petits Explorateurs",
                "Calendrier des activites — Mars 2026",
                "",
                "Semaine 1 : Theme de la semaine — Les animaux",
                "  Lundi    : Bricolage animaux de la ferme",
                "  Mercredi : Visite du Zoo mobile",
                "  Vendredi : Parade deguisements animaux",
                "",
                "Semaine 2 : Theme de la semaine — Le printemps",
                "  Mardi    : Plantation de graines",
                "  Jeudi    : Sortie au parc",
                "",
                "Journee pedagogique : vendredi 28 mars",
                "La garderie sera fermee toute la journee.",
            ],
        },
    ];

    for doc in &docs {
        let id       = Uuid::new_v4();
        let filename = format!("{id}.pdf");

        let pdf_data  = generate_pdf(doc.title, doc.lines);
        let size_bytes = pdf_data.len() as i64;

        tokio::fs::write(docs_dir.join(&filename), &pdf_data).await?;

        let storage_path = format!("demo/{year}/{month}/docs/{filename}");

        sqlx::query(&format!(
            r#"INSERT INTO "{schema}".documents
               (id, uploader_id, title, category, original_filename,
                storage_path, content_type, size_bytes, visibility, is_encrypted)
               VALUES ($1, $2, $3, $4::"{schema}".doc_category, $5,
                       $6, 'application/pdf', $7, 'public'::"{schema}".doc_visibility, false)"#
        ))
        .bind(id)
        .bind(uploader_id)
        .bind(doc.title)
        .bind(doc.category)
        .bind(&filename)
        .bind(&storage_path)
        .bind(size_bytes)
        .execute(pool)
        .await
        .with_context(|| format!("Failed to insert document '{}'", doc.title))?;
    }

    println!("  {} documents générés", docs.len());

    Ok(())
}

// ─── Image helpers ────────────────────────────────────────────────────────────

/// Generate a gradient JPEG image (diagonal gradient from `bg` to `accent`).
fn generate_photo(width: u32, height: u32, bg: [u8; 3], accent: [u8; 3]) -> Vec<u8> {
    let mut img = RgbImage::new(width, height);

    for (x, y, pixel) in img.enumerate_pixels_mut() {
        let tx = x as f32 / width as f32;
        let ty = y as f32 / height as f32;
        let t  = (tx * 0.55 + ty * 0.45).clamp(0.0, 1.0) * 0.45;
        let r  = lerp(bg[0], accent[0], t);
        let g  = lerp(bg[1], accent[1], t);
        let b  = lerp(bg[2], accent[2], t);
        *pixel = image::Rgb([r, g, b]);
    }

    let dyn_img = DynamicImage::ImageRgb8(img);
    let mut buf = std::io::Cursor::new(Vec::new());
    dyn_img.write_to(&mut buf, ImageFormat::Jpeg).unwrap();
    buf.into_inner()
}

fn lerp(a: u8, b: u8, t: f32) -> u8 {
    (a as f32 + (b as f32 - a as f32) * t).clamp(0.0, 255.0) as u8
}

fn make_thumbnail(data: &[u8]) -> Vec<u8> {
    let img   = image::load_from_memory(data).unwrap();
    let thumb = img.resize(200, 150, image::imageops::FilterType::Lanczos3);
    let mut buf = std::io::Cursor::new(Vec::new());
    thumb.write_to(&mut buf, ImageFormat::Jpeg).unwrap();
    buf.into_inner()
}

// ─── PDF helper ───────────────────────────────────────────────────────────────

/// Generate a minimal but valid single-page PDF with Helvetica text.
fn generate_pdf(title: &str, lines: &[&str]) -> Vec<u8> {
    // Build the page content stream
    let mut stream = String::new();
    stream += "BT\n";
    stream += "/F1 15 Tf\n50 800 Td\n";
    stream += &format!("({}) Tj\n", pdf_escape(title));
    stream += "/F1 11 Tf\n";
    for line in lines {
        stream += "0 -22 Td\n";
        stream += &format!("({}) Tj\n", pdf_escape(line));
    }
    stream += "ET\n";

    // Build PDF body, tracking byte offsets for xref
    let mut body = String::new();
    body += "%PDF-1.4\n";

    let o1 = body.len();
    body += "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";

    let o2 = body.len();
    body += "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";

    let o3 = body.len();
    body += "3 0 obj\n";
    body += "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]\n";
    body += "/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>\n";
    body += "/Contents 4 0 R >>\n";
    body += "endobj\n";

    let o4 = body.len();
    body += &format!("4 0 obj\n<< /Length {} >>\nstream\n{}endstream\nendobj\n", stream.len(), stream);

    let xref_pos = body.len();
    body += "xref\n0 5\n";
    body += "0000000000 65535 f \n";
    body += &format!("{:010} 00000 n \n", o1);
    body += &format!("{:010} 00000 n \n", o2);
    body += &format!("{:010} 00000 n \n", o3);
    body += &format!("{:010} 00000 n \n", o4);
    body += &format!("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", xref_pos);

    body.into_bytes()
}

/// Escape special PDF string characters.
fn pdf_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
     .replace('(', "\\(")
     .replace(')', "\\)")
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/// Returns the last `n` business days (Mon–Fri), most recent last.
fn last_n_business_days(from: NaiveDate, n: usize) -> Vec<NaiveDate> {
    let mut days = Vec::with_capacity(n);
    let mut date = from;
    while days.len() < n {
        match date.weekday() {
            Weekday::Sat | Weekday::Sun => {}
            _ => days.push(date),
        }
        date -= Duration::days(1);
    }
    days.reverse();
    days
}
