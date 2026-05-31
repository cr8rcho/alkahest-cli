import { Link } from "expo-router";
import { View } from "react-native";

// Under a route group `(tabs)` — the group segment is stripped, so route = "/profile".
export default function Profile() {
  return (
    <View>
      <Link href="/">Home</Link>
    </View>
  );
}
