import { router } from "expo-router";
import { View, Button } from "react-native";

export default function Details() {
  return (
    <View>
      <Button title="Home" onPress={() => router.push("/")} />
    </View>
  );
}
