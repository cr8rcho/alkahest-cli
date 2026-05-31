import { View, Button } from "react-native";

export default function DetailsScreen({ navigation }) {
  return (
    <View>
      <Button title="Back home" onPress={() => navigation.navigate("Home")} />
    </View>
  );
}
