import { useState, useEffect, useRef } from 'react';
import { calculateDiscountSavings } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from './AnimatedNumber';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Calculator, Upload, DollarSign } from 'lucide-react';

interface DiscountCalculatorProps {
  className?: string;
}

interface InvoiceData {
  invoiceAmount: number;
  discountPercent?: number;
  daysEarly?: number;
  costOfCapital?: number;
}

export function DiscountCalculator({ className }: DiscountCalculatorProps) {
  const [invoiceAmount, setInvoiceAmount] = useState(25000);
  const [discountPercent, setDiscountPercent] = useState(2);
  const [daysEarly, setDaysEarly] = useState(20);
  const [costOfCapital, setCostOfCapital] = useState(12);
  const [result, setResult] = useState<ReturnType<typeof calculateDiscountSavings> | null>(null);
  const [showCalculator, setShowCalculator] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCalculator) {
      const newResult = calculateDiscountSavings(invoiceAmount, discountPercent, daysEarly, costOfCapital);
      setResult(newResult);
    }
  }, [invoiceAmount, discountPercent, daysEarly, costOfCapital, showCalculator]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      processFile(file);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.name.endsWith('.json')) {
      setUploadStatus('❌ Please upload a JSON file');
      setTimeout(() => setUploadStatus(''), 3000);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        
        // Check if it has both contract and invoice data (exported from Contract Management)
        if (data.contract && data.invoice) {
          const invoice = data.invoice;
          setInvoiceAmount(invoice.invoiceAmount || invoice.amount);
          if (invoice.discountPercent) setDiscountPercent(invoice.discountPercent);
          if (invoice.daysEarly) setDaysEarly(invoice.daysEarly);
          if (invoice.costOfCapital) setCostOfCapital(invoice.costOfCapital);
          
          setShowCalculator(true);
          setUploadStatus(`✅ Contract ${data.contract.id} loaded successfully!`);
          setTimeout(() => setUploadStatus(''), 3000);
          return;
        }
        
        // Check if it's a direct invoice format
        if (data.invoiceAmount && data.invoiceAmount > 0) {
          setInvoiceAmount(data.invoiceAmount);
          if (data.discountPercent) setDiscountPercent(data.discountPercent);
          if (data.daysEarly) setDaysEarly(data.daysEarly);
          if (data.costOfCapital) setCostOfCapital(data.costOfCapital);
          
          setShowCalculator(true);
          setUploadStatus('✅ Invoice uploaded successfully!');
          setTimeout(() => setUploadStatus(''), 3000);
          return;
        }
        
        // Check if it's an invoice object with standard fields
        if (data.invoice) {
          const invoice = data.invoice;
          const amount = parseFloat(invoice.amount || invoice.total || invoice.invoiceAmount || '0');
          
          if (amount <= 0) {
            setUploadStatus('❌ Invalid invoice data - no amount found');
            setTimeout(() => setUploadStatus(''), 3000);
            return;
          }

          setInvoiceAmount(amount);
          if (invoice.discountPercent) setDiscountPercent(invoice.discountPercent);
          if (invoice.daysEarly) setDaysEarly(invoice.daysEarly);
          if (invoice.costOfCapital) setCostOfCapital(invoice.costOfCapital);
          
          setShowCalculator(true);
          setUploadStatus('✅ Invoice uploaded successfully!');
          setTimeout(() => setUploadStatus(''), 3000);
          return;
        }
        
        setUploadStatus('❌ Invalid file format - please use invoice format');
        setTimeout(() => setUploadStatus(''), 3000);
      } catch (error) {
        setUploadStatus('❌ Invalid JSON format');
        setTimeout(() => setUploadStatus(''), 3000);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className={cn('space-y-6', className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />

      {uploadStatus && (
        <div className="p-3 bg-muted/30 rounded-lg text-center">
          <p className="text-sm font-medium">{uploadStatus}</p>
        </div>
      )}

      {!showCalculator ? (
        <div 
          ref={dropZoneRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleUploadClick}
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all",
            isDragging 
              ? "border-primary bg-primary/10" 
              : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/50"
          )}
        >
          <DollarSign size={48} className="mx-auto mb-4 text-muted-foreground" />
          <h4 className="font-semibold mb-2">Upload Invoice File</h4>
          <p className="text-sm text-muted-foreground mb-4">
            Drag and drop your JSON file here, or click to browse
          </p>
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleUploadClick(); }}>
            <Upload size={16} className="mr-2" />
            Choose File
          </Button>
          <p className="text-xs text-muted-foreground mt-4">
            Supported format: JSON (Invoice data only)
          </p>
        </div>
      ) : (
        <>
          {/* Inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Invoice Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={invoiceAmount}
                  onChange={(e) => setInvoiceAmount(Number(e.target.value))}
                  className="pl-7 font-mono bg-background/50"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Cost of Capital</Label>
              <div className="relative">
                <Input
                  type="number"
                  value={costOfCapital}
                  onChange={(e) => setCostOfCapital(Number(e.target.value))}
                  className="pr-7 font-mono bg-background/50"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-xs text-muted-foreground">Discount Offered</Label>
                <span className="text-sm font-mono text-primary">{discountPercent}%</span>
              </div>
              <Slider
                value={[discountPercent]}
                onValueChange={([val]) => setDiscountPercent(val)}
                min={0.5}
                max={5}
                step={0.25}
                className="py-2"
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-xs text-muted-foreground">Days Early Payment</Label>
                <span className="text-sm font-mono text-primary">{daysEarly} days</span>
              </div>
              <Slider
                value={[daysEarly]}
                onValueChange={([val]) => setDaysEarly(val)}
                min={5}
                max={45}
                step={1}
                className="py-2"
              />
            </div>
          </div>
          
          {/* Formula Display */}
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Calculator size={16} className="text-primary" />
              <span className="text-xs font-medium text-muted-foreground">APR Calculation</span>
            </div>
            <div className="font-mono text-xs bg-background/50 p-3 rounded-lg overflow-x-auto">
              <p className="text-muted-foreground">
                APR = ({discountPercent}% / (100 - {discountPercent}%)) × (365 / {daysEarly}) × 100
              </p>
              <p className="text-foreground mt-1">
                APR = {result?.apr.toFixed(2)}%
              </p>
            </div>
          </div>
          
          {/* Result */}
          {result && (
            <div className={cn(
              'p-4 rounded-xl border-2',
              result.recommendation === 'TAKE'
                ? 'bg-success/10 border-success/50'
                : 'bg-destructive/10 border-destructive/50',
            )}>
              <div className="flex items-center gap-3 mb-4">
                {result.recommendation === 'TAKE' ? (
                  <CheckCircle size={24} className="text-success" />
                ) : (
                  <XCircle size={24} className="text-destructive" />
                )}
                <div>
                  <p className={cn(
                    'font-bold text-lg',
                    result.recommendation === 'TAKE' ? 'text-success' : 'text-destructive',
                  )}>
                    {result.recommendation === 'TAKE' ? '✅ TAKE DISCOUNT' : '❌ SKIP DISCOUNT'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {result.recommendation === 'TAKE' 
                      ? 'APR exceeds cost of capital'
                      : 'APR below cost of capital'}
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">APR Equivalent</p>
                  <p className="font-mono font-bold text-xl">
                    <AnimatedNumber value={result.apr} decimals={2} suffix="%" />
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Gross Savings</p>
                  <p className="font-mono font-bold text-xl text-success">
                    <AnimatedNumber value={result.savings} format="currency" />
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Opportunity Cost</p>
                  <p className="font-mono font-bold text-xl text-chart-payable">
                    <AnimatedNumber value={result.opportunityCost} format="currency" />
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Net Benefit</p>
                  <p className={cn(
                    'font-mono font-bold text-xl',
                    result.netBenefit >= 0 ? 'text-success' : 'text-destructive',
                  )}>
                    <AnimatedNumber value={result.netBenefit} format="currency" />
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-center">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowCalculator(false)}
            >
              <Upload size={16} className="mr-2" />
              Upload New Invoice
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
