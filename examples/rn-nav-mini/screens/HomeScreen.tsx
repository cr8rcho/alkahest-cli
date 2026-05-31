import { View, Button } from "react-native";

export default function HomeScreen({ navigation }) {
  return (
    <View>
      <Button title="Go to details" onPress={() => navigation.navigate("Details")} />
    </View>
  );
}
