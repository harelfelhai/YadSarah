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
    }
}
