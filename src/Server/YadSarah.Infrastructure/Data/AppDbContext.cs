using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;

namespace YadSarah.Infrastructure.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Patient> Patients => Set<Patient>();
    public DbSet<Visit> Visits => Set<Visit>();
    public DbSet<MedicalForm> MedicalForms => Set<MedicalForm>();
    public DbSet<User> Users => Set<User>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<FormLock> FormLocks => Set<FormLock>();
    public DbSet<QueueCounter> QueueCounters => Set<QueueCounter>();
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();
    public DbSet<Medication> Medications => Set<Medication>();
    public DbSet<FeedbackReport> FeedbackReports => Set<FeedbackReport>();
    public DbSet<Workstation> Workstations => Set<Workstation>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // Patient
        b.Entity<Patient>(e =>
        {
            e.HasKey(p => p.Id);
            e.HasIndex(p => p.IdentityNumber);
            // Block duplicate identities at the DB level (allows multiple NULL/empty,
            // e.g. newborns / unknown). Unique per identity type + number.
            e.HasIndex(p => new { p.IdentityType, p.IdentityNumber })
                .IsUnique()
                .HasFilter("\"IdentityNumber\" IS NOT NULL AND \"IdentityNumber\" <> ''");
            e.Property(p => p.FirstName).HasMaxLength(100).IsRequired();
            e.Property(p => p.LastName).HasMaxLength(100).IsRequired();
            e.Property(p => p.IdentityType).HasMaxLength(50).IsRequired();
        });

        // Visit
        b.Entity<Visit>(e =>
        {
            e.HasKey(v => v.Id);
            e.HasOne(v => v.Patient).WithMany(p => p.Visits).HasForeignKey(v => v.PatientId);
            e.Property(v => v.Status).HasConversion<string>();
            e.Property(v => v.TreatingUserRole).HasConversion<string>();
            e.HasIndex(v => v.Status);
            // Auto-increment queue number per day handled in service layer
        });

        // MedicalForm
        b.Entity<MedicalForm>(e =>
        {
            e.HasKey(f => f.Id);
            e.HasOne(f => f.Visit).WithMany(v => v.Forms).HasForeignKey(f => f.VisitId);
            e.Property(f => f.StationType).HasMaxLength(50).IsRequired();
            e.Property(f => f.FormType).HasMaxLength(50).IsRequired();
            // Use EF row-version for optimistic concurrency backstop
            e.Property(f => f.Version).IsConcurrencyToken();
        });

        // User
        b.Entity<User>(e =>
        {
            e.HasKey(u => u.Id);
            e.HasIndex(u => u.Username).IsUnique();
            e.Property(u => u.Role).HasConversion<string>();
        });

        // AuditLog — append-only, no updates
        b.Entity<AuditLog>(e =>
        {
            e.HasKey(a => a.Id);
            e.Property(a => a.Id).UseIdentityAlwaysColumn();
            e.HasIndex(a => new { a.EntityType, a.EntityId });
            e.HasIndex(a => a.Timestamp);
        });

        // FormLock — composite PK (FormId + SectionName)
        b.Entity<FormLock>(e =>
        {
            e.HasKey(l => new { l.FormId, l.SectionName });
            e.HasIndex(l => l.ExpiresAt);
        });

        // QueueCounter — one row per day (PK = date)
        b.Entity<QueueCounter>(e =>
        {
            e.HasKey(c => c.DateKey);
        });

        // SystemSetting — key/value config (PK = key)
        b.Entity<SystemSetting>(e =>
        {
            e.HasKey(s => s.Key);
            e.Property(s => s.Key).HasMaxLength(100);
        });

        // Medication — official drug catalog (internal copy of the MoH registry)
        b.Entity<Medication>(e =>
        {
            e.HasKey(m => m.Id);
            e.Property(m => m.RegistrationNumber).HasMaxLength(50).IsRequired();
            e.Property(m => m.HebrewName).HasMaxLength(300).IsRequired();
            e.Property(m => m.EnglishName).HasMaxLength(300);
            e.HasIndex(m => m.RegistrationNumber).IsUnique();
            // Search indexes for autocomplete (prefix/ILIKE on names)
            e.HasIndex(m => m.HebrewName);
            e.HasIndex(m => m.EnglishName);
        });

        // FeedbackReport — user-submitted bug/fix/improvement reports (Admin-managed)
        b.Entity<FeedbackReport>(e =>
        {
            e.HasKey(f => f.Id);
            e.Property(f => f.Screen).HasMaxLength(100).IsRequired();
            e.Property(f => f.FieldName).HasMaxLength(150).IsRequired();
            e.Property(f => f.Description).HasMaxLength(4000).IsRequired();
            e.Property(f => f.ReportType).HasConversion<string>();
            e.Property(f => f.Status).HasConversion<string>();
            e.HasIndex(f => f.Status);
            e.HasIndex(f => f.CreatedAt);
        });

        // Workstation — one row per LAN computer (device id → fixed room)
        b.Entity<Workstation>(e =>
        {
            e.HasKey(w => w.Id);
            e.Property(w => w.DeviceId).HasMaxLength(120).IsRequired();
            e.HasIndex(w => w.DeviceId).IsUnique();
            e.Property(w => w.RoomName).HasMaxLength(60).IsRequired();
            // Store role as its string name, consistent with User.Role / Visit.TreatingUserRole
            e.Property(w => w.CurrentUserRole).HasConversion<string>();
        });
    }
}
