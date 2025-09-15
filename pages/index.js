import React, { useState, useEffect } from 'react';
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  Select,
  Spinner,
  Badge,
  Stack,
  ProgressBar,
  Banner,
  Modal,
  FormLayout,
  TextField,
  DropZone,
  Caption
} from '@shopify/polaris';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState(null);
  const [adSpendData, setAdSpendData] = useState(null);
  const [timeRange, setTimeRange] = useState('30');
  const [settingsModal, setSettingsModal] = useState(false);
  const [cogsModal, setCogsModal] = useState(false);
  const [settings, setSettings] = useState({
    defaultCOGSPercentage: 30
  });
  const [file, setFile] = useState(null);

  const timeRangeOptions = [
    { label: '7 days', value: '7' },
    { label: '30 days', value: '30' },
    { label: '90 days', value: '90' }
  ];

  useEffect(() => {
    fetchDashboardData();
    fetchAdSpendData();
  }, [timeRange]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/dashboard');
      const data = await response.json();
      setDashboardData(data);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdSpendData = async () => {
    try {
      const endDate = new Date();
      const startDate = subDays(endDate, parseInt(timeRange));
      
      const response = await fetch(`/api/ad-spend?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`);
      const data = await response.json();
      setAdSpendData(data);
    } catch (error) {
      console.error('Failed to fetch ad spend data:', error);
    }
  };

  const saveSettings = async () => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      setSettingsModal(false);
      fetchDashboardData();
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  const uploadCogsFile = async () => {
    if (!file) return;
    
    try {
      const formData = new FormData();
      formData.append('cogsFile', file);
      
      await fetch('/api/upload-cogs', {
        method: 'POST',
        body: formData
      });
      
      setCogsModal(false);
      setFile(null);
      fetchDashboardData();
    } catch (error) {
      console.error('Failed to upload COGS file:', error);
    }
  };

  const handleDropZoneDrop = (files) => {
    setFile(files[0]);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const calculateProfitMargin = () => {
    if (!dashboardData || dashboardData.totalRevenue === 0) return 0;
    const totalAdSpend = adSpendData?.totalAdSpend || 0;
    const netProfit = dashboardData.grossProfit - totalAdSpend;
    return ((netProfit / dashboardData.totalRevenue) * 100).toFixed(1);
  };

  const getNetProfit = () => {
    if (!dashboardData) return 0;
    const totalAdSpend = adSpendData?.totalAdSpend || 0;
    return dashboardData.grossProfit - totalAdSpend;
  };

  if (loading && !dashboardData) {
    return (
      <Page title="Doughboard">
        <Layout>
          <Layout.Section>
            <Card>
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <Spinner size="large" />
                <Text variant="bodyMd">Loading your profit dashboard...</Text>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const chartData = dashboardData ? [
    { name: 'Revenue', value: dashboardData.totalRevenue },
    { name: 'COGS', value: dashboardData.totalCOGS },
    { name: 'Ad Spend', value: adSpendData?.totalAdSpend || 0 },
    { name: 'Net Profit', value: getNetProfit() }
  ] : [];

  return (
    <Page
      title="Doughboard"
      primaryAction={{
        content: 'Settings',
        onAction: () => setSettingsModal(true)
      }}
      secondaryActions={[
        {
          content: 'Upload COGS',
          onAction: () => setCogsModal(true)
        }
      ]}
    >
      <Layout>
        <Layout.Section>
          <Stack distribution="trailing">
            <Select
              label="Time Range"
              options={timeRangeOptions}
              value={timeRange}
              onChange={setTimeRange}
            />
          </Stack>
        </Layout.Section>

        {!adSpendData?.totalAdSpend && (
          <Layout.Section>
            <Banner status="info">
              Connect your ad accounts to see complete profit calculations. 
              <Button plain>Connect Ad Accounts</Button>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Layout>
            <Layout.Section oneThird>
              <Card>
                <Stack vertical spacing="tight">
                  <Text variant="headingMd">Total Revenue</Text>
                  <Text variant="heading2xl" color="success">
                    {formatCurrency(dashboardData?.totalRevenue || 0)}
                  </Text>
                  <Text variant="bodySm" color="subdued">
                    {dashboardData?.orderCount || 0} orders
                  </Text>
                </Stack>
              </Card>
            </Layout.Section>

            <Layout.Section oneThird>
              <Card>
                <Stack vertical spacing="tight">
                  <Text variant="headingMd">Net Profit</Text>
                  <Text 
                    variant="heading2xl" 
                    color={getNetProfit() >= 0 ? "success" : "critical"}
                  >
                    {formatCurrency(getNetProfit())}
                  </Text>
                  <Stack>
                    <Badge status={parseFloat(calculateProfitMargin()) >= 20 ? "success" : "attention"}>
                      {calculateProfitMargin()}% margin
                    </Badge>
                  </Stack>
                </Stack>
              </Card>
            </Layout.Section>

            <Layout.Section oneThird>
              <Card>
                <Stack vertical spacing="tight">
                  <Text variant="headingMd">Ad Spend</Text>
                  <Text variant="heading2xl" color="critical">
                    {formatCurrency(adSpendData?.totalAdSpend || 0)}
                  </Text>
                  <Text variant="bodySm" color="subdued">
                    Last {timeRange} days
                  </Text>
                </Stack>
              </Card>
            </Layout.Section>
          </Layout>
        </Layout.Section>

        <Layout.Section>
          <Layout>
            <Layout.Section oneHalf>
              <Card title="Revenue Breakdown" sectioned>
                <Stack vertical spacing="loose">
                  <Stack distribution="equalSpacing">
                    <Text variant="bodyMd">New Customers</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {formatCurrency(dashboardData?.newCustomerRevenue || 0)}
                    </Text>
                  </Stack>
                  <ProgressBar 
                    progress={dashboardData?.totalRevenue ? 
                      (dashboardData.newCustomerRevenue / dashboardData.totalRevenue) * 100 : 0
                    } 
                  />
                  
                  <Stack distribution="equalSpacing">
                    <Text variant="bodyMd">Returning Customers</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {formatCurrency(dashboardData?.returningCustomerRevenue || 0)}
                    </Text>
                  </Stack>
                  <ProgressBar 
                    progress={dashboardData?.totalRevenue ? 
                      (dashboardData.returningCustomerRevenue / dashboardData.totalRevenue) * 100 : 0
                    } 
                  />
                </Stack>
              </Card>
            </Layout.Section>

            <Layout.Section oneHalf>
              <Card title="Cost Breakdown" sectioned>
                <Stack vertical spacing="loose">
                  <Stack distribution="equalSpacing">
                    <Text variant="bodyMd">COGS</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {formatCurrency(dashboardData?.totalCOGS || 0)}
                    </Text>
                  </Stack>
                  
                  <Stack distribution="equalSpacing">
                    <Text variant="bodyMd">Meta Ads</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {formatCurrency(
                        adSpendData?.breakdown?.find(b => b.platform === 'Meta')?.total || 0
                      )}
                    </Text>
                  </Stack>
                  
                  <Stack distribution="equalSpacing">
                    <Text variant="bodyMd">Google Ads</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {formatCurrency(
                        adSpendData?.breakdown?.find(b => b.platform === 'Google')?.total || 0
                      )}
                    </Text>
                  </Stack>
                </Stack>
              </Card>
            </Layout.Section>
          </Layout>
        </Layout.Section>

        <Layout.Section>
          <Card title="Profit Overview" sectioned>
            <div style={{ height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Bar dataKey="value" fill="#6366f1" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Settings Modal */}
      <Modal
        open={settingsModal}
        onClose={() => setSettingsModal(false)}
        title="Dashboard Settings"
        primaryAction={{
          content: 'Save',
          onAction: saveSettings
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setSettingsModal(false)
          }
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Default COGS Percentage"
              type="number"
              value={settings.defaultCOGSPercentage.toString()}
              onChange={(value) => setSettings({
                ...settings,
                defaultCOGSPercentage: parseFloat(value) || 0
              })}
              suffix="%"
              helpText="Used when specific product COGS are not available"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* COGS Upload Modal */}
      <Modal
        open={cogsModal}
        onClose={() => setCogsModal(false)}
        title="Upload COGS Data"
        primaryAction={{
          content: 'Upload',
          onAction: uploadCogsFile,
          disabled: !file
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setCogsModal(false)
          }
        ]}
      >
        <Modal.Section>
          <Stack vertical spacing="loose">
            <Text variant="bodyMd">
              Upload a CSV file with columns: SKU, COGS
            </Text>
            <DropZone onDrop={handleDropZoneDrop} accept=".csv">
              {file ? (
                <Stack vertical>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {file.name}
                  </Text>
                  <Caption>{(file.size / 1024).toFixed(1)} KB</Caption>
                </Stack>
              ) : (
                <DropZone.FileUpload />
              )}
            </DropZone>
          </Stack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
