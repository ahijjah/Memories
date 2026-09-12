import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { listPeople, createPerson, deletePerson, Person, CreatePersonRequest } from '@/src/api/client';

export default function PeopleScreen() {
  const { getToken } = useAuth();
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonRelationship, setNewPersonRelationship] = useState('');

  const { data: people = [], isLoading, refetch } = useQuery({
    queryKey: ['people'],
    queryFn: async () => {
      const token = await getToken();
      return listPeople(token);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (dto: CreatePersonRequest) => {
      const token = await getToken();
      return createPerson(token, dto);
    },
    onSuccess: () => {
      setNewPersonName('');
      setNewPersonRelationship('');
      refetch();
    },
    onError: () => {
      Alert.alert('Error', 'Failed to create person');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (personId: string) => {
      const token = await getToken();
      return deletePerson(token, personId);
    },
    onSuccess: () => {
      refetch();
    },
    onError: () => {
      Alert.alert('Error', 'Failed to delete person');
    },
  });

  const handleAddPerson = () => {
    if (!newPersonName.trim()) {
      Alert.alert('Error', 'Please enter a name');
      return;
    }
    createMutation.mutate({
      name: newPersonName.trim(),
      relationship: newPersonRelationship.trim() || undefined,
    });
  };

  const handleDeletePerson = (person: Person) => {
    Alert.alert('Delete Person', `Are you sure you want to delete ${person.name}?`, [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Delete',
        onPress: () => deleteMutation.mutate(person.id),
        style: 'destructive',
      },
    ]);
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>People</Text>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Name</Text>
          <View style={styles.input}>
            <Text>{newPersonName || 'Enter name...'}</Text>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Relationship</Text>
          <View style={styles.input}>
            <Text>{newPersonRelationship || 'e.g., mother, friend...'}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={handleAddPerson}
          disabled={createMutation.isPending}
        >
          <Text style={styles.buttonText}>
            {createMutation.isPending ? 'Adding...' : 'Add Person'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subtitle}>Your People ({people.length})</Text>
      <FlatList
        data={people}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.personCard}>
            <View style={styles.personInfo}>
              <Text style={styles.personName}>{item.name}</Text>
              {item.relationship && (
                <Text style={styles.personRelationship}>{item.relationship}</Text>
              )}
            </View>
            <TouchableOpacity
              onPress={() => handleDeletePerson(item)}
              disabled={deleteMutation.isPending}
            >
              <Text style={styles.deleteButton}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No people added yet</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  form: {
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 4,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  personCard: {
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 16,
    fontWeight: '600',
  },
  personRelationship: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  deleteButton: {
    color: '#FF3B30',
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    color: '#999',
    marginTop: 24,
  },
});
