using System.Text.Json;
using System.Text.Json.Serialization;

namespace YadSarah.Api.Converters;

// Accepts both "HH:mm" (from frontend) and "HH:mm:ss" (ISO 8601) on deserialization.
public class TimeOnlyJsonConverter : JsonConverter<TimeOnly>
{
    public override TimeOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var s = reader.GetString();
        if (s is null) return default;

        if (TimeOnly.TryParseExact(s, "HH:mm", null, System.Globalization.DateTimeStyles.None, out var t))
            return t;
        if (TimeOnly.TryParseExact(s, "HH:mm:ss", null, System.Globalization.DateTimeStyles.None, out t))
            return t;

        throw new JsonException($"Cannot parse '{s}' as TimeOnly");
    }

    public override void Write(Utf8JsonWriter writer, TimeOnly value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToString("HH:mm:ss"));
    }
}
