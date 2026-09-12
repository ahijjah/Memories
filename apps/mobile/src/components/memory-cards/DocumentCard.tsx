import { View, Text, TouchableOpacity } from 'react-native';
import { useState } from 'react';
import { ConfirmableField } from './ConfirmableField';

interface DocumentCardProps {
  memoryId: string;
  isVault?: boolean;
  aiSummary: any;
  aiTopics: any;
  aiIntent: any;
  aiEntities: any;
  aiDate: any;
  aiCategory: any;
  aiIssuer: any;
  aiOwner: any;
  aiDocumentNumber?: any;
  aiIssueDate?: any;
  fieldConfidences?: { [key: string]: number | null };
  fieldConfirmations?: { [key: string]: boolean };
  onFieldConfirmed?: () => void;
}

export function DocumentCard({
  memoryId,
  isVault = false,
  aiSummary,
  aiTopics,
  aiIntent,
  aiEntities,
  aiDate,
  aiCategory,
  aiIssuer,
  aiOwner,
  aiDocumentNumber,
  aiIssueDate,
  fieldConfidences = {},
  fieldConfirmations = {},
  onFieldConfirmed = () => {},
}: DocumentCardProps) {
  const [isDocumentNumberRevealed, setIsDocumentNumberRevealed] = useState(false);
  const hasDocumentInfo = aiCategory || aiIssuer || aiOwner || aiDate || aiDocumentNumber || aiIssueDate;
  const isExpired = aiDate ? new Date(aiDate) < new Date() : false;

  return (
    <>
      {/* Document Info — unified box with Type/Issuer/Owner/Expires */}
      {hasDocumentInfo && (
        <View className="mb-6 p-4 bg-orange-50 rounded-lg border border-orange-200">
          <Text className="text-lg font-semibold text-gray-900 mb-3">Document</Text>

          {aiCategory && (
            <ConfirmableField
              label="Type"
              value={aiCategory}
              confidence={fieldConfidences['category']}
              fieldType="text"
              memoryId={memoryId}
              field="category"
              isConfirmed={fieldConfirmations['category'] || false}
              isVault={isVault}
              onConfirmed={onFieldConfirmed}
            />
          )}

          {aiIssuer && (
            <ConfirmableField
              label="Issuer"
              value={aiIssuer}
              confidence={fieldConfidences['issuer']}
              fieldType="text"
              memoryId={memoryId}
              field="issuer"
              isConfirmed={fieldConfirmations['issuer'] || false}
              isVault={isVault}
              onConfirmed={onFieldConfirmed}
            />
          )}

          {aiOwner && (
            <ConfirmableField
              label="Owner"
              value={aiOwner}
              confidence={fieldConfidences['owner']}
              fieldType="text"
              memoryId={memoryId}
              field="owner"
              isConfirmed={fieldConfirmations['owner'] || false}
              isVault={isVault}
              onConfirmed={onFieldConfirmed}
            />
          )}

          {aiDocumentNumber && (
            <View className="mb-2">
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Text className="text-xs text-gray-600 mb-1">Document #</Text>
                  <Text className="text-base text-gray-900">
                    {isDocumentNumberRevealed ? (
                      <Text>{aiDocumentNumber}</Text>
                    ) : (
                      <Text>{aiDocumentNumber.length < 4 ? '••••••••' : '•••• •••• ' + aiDocumentNumber.slice(-4)}</Text>
                    )}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setIsDocumentNumberRevealed(!isDocumentNumberRevealed)}
                  className="px-2 py-1"
                >
                  <Text className="text-xs font-semibold text-blue-600">
                    {isDocumentNumberRevealed ? 'Hide' : 'Show'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {aiIssueDate && (
            <ConfirmableField
              label="Issued"
              value={aiIssueDate}
              confidence={fieldConfidences['issueDate']}
              fieldType="date"
              memoryId={memoryId}
              field="issueDate"
              isConfirmed={fieldConfirmations['issueDate'] || false}
              isVault={isVault}
              onConfirmed={onFieldConfirmed}
            />
          )}

          {aiDate && (
            <View className="mb-2">
              <ConfirmableField
                label="Expires"
                value={aiDate}
                confidence={fieldConfidences['date']}
                fieldType="date"
                memoryId={memoryId}
                field="date"
                isConfirmed={fieldConfirmations['date'] || false}
                isVault={isVault}
                onConfirmed={onFieldConfirmed}
              />
              <View className={`px-2 py-1 rounded mt-2 w-fit ${isExpired ? 'bg-red-100' : 'bg-green-100'}`}>
                <Text className={`text-xs font-semibold ${isExpired ? 'text-red-700' : 'text-green-700'}`}>
                  {isExpired ? 'Expired' : 'Current'}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Summary */}
      {aiSummary ? (
        <View className="mb-6">
          <Text className="text-lg font-semibold text-gray-900 mb-2">Summary</Text>
          <Text className="text-base text-gray-700 leading-6">{aiSummary}</Text>
        </View>
      ) : null}

      {/* Topics */}
      {aiTopics && Array.isArray(aiTopics) && aiTopics.length > 0 ? (
        <View className="mb-6">
          <Text className="text-lg font-semibold text-gray-900 mb-3">Topics</Text>
          <View className="flex-row flex-wrap gap-2">
            {aiTopics.map((topic: string, idx: number) => (
              <View key={idx} className="bg-blue-100 rounded-full px-4 py-2">
                <Text className="text-blue-900 text-sm font-medium">{topic}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Additional Details */}
      {(aiIntent || (aiEntities && Array.isArray(aiEntities) && aiEntities.length > 0)) ? (
        <View className="mb-6 p-4 bg-indigo-50 rounded-lg">
          <Text className="text-lg font-semibold text-gray-900 mb-3">Details</Text>

          {aiIntent && (
            <View className="mb-3">
              <Text className="text-sm text-gray-600">
                <Text className="font-semibold">Intent:</Text> <Text className="text-indigo-600 font-medium">{aiIntent}</Text>
              </Text>
            </View>
          )}

          {aiEntities && Array.isArray(aiEntities) && aiEntities.length > 0 && (
            <View>
              <Text className="text-sm text-gray-600 font-semibold mb-2">Entities:</Text>
              <View className="flex-row flex-wrap gap-2">
                {aiEntities.map((entity: string, idx: number) => (
                  <View key={idx} className="bg-indigo-100 rounded-full px-3 py-1">
                    <Text className="text-indigo-800 text-xs font-medium">{entity}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      ) : null}
    </>
  );
}
