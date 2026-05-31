import { Link, useRouter } from "expo-router";
import { View, Button } from "react-native";

export default function Home() {
  const router = useRouter();
  return (
    <View>
      <Link href="/details">Details</Link>
      <Button title="Profile" onPress={() => router.push("/profile")} />
    </View>
  );
}
