namespace YadSarah.Application.Services;

/// <summary>
/// Password complexity policy for a "high security level" database under the
/// Israeli Privacy Protection (Data Security) Regulations 2017.
/// Minimum 12 chars with upper, lower, digit and a special character.
/// </summary>
public static class PasswordPolicy
{
    public const int MinLength = 12;

    public static (bool ok, string? error) Validate(string? password)
    {
        if (string.IsNullOrEmpty(password) || password.Length < MinLength)
            return (false, $"הסיסמה חייבת להכיל לפחות {MinLength} תווים.");
        if (!password.Any(char.IsUpper))
            return (false, "הסיסמה חייבת להכיל אות גדולה אחת לפחות.");
        if (!password.Any(char.IsLower))
            return (false, "הסיסמה חייבת להכיל אות קטנה אחת לפחות.");
        if (!password.Any(char.IsDigit))
            return (false, "הסיסמה חייבת להכיל ספרה אחת לפחות.");
        if (password.All(char.IsLetterOrDigit))
            return (false, "הסיסמה חייבת להכיל תו מיוחד אחד לפחות.");
        return (true, null);
    }
}
