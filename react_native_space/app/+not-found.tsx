import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useRouter } from 'expo-router';

export default function NotFound() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text variant="headlineMedium">Page not found</Text>
      <Button mode="contained" onPress={() => router.replace('/')} style={{ marginTop: 16 }}>Go to Chat</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
});
